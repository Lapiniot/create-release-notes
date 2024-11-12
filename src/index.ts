import { getInput, info, setFailed, setOutput, warning } from "@actions/core";
import { context, getOctokit } from "@actions/github";
import YAML from "../ts-yaml/src/Parser";
import defaultConfig from "./release.json";

type Unwrap<T> = T extends Promise<infer P> ? P : T;
type OctokitClient = ReturnType<typeof getOctokit>;
type Issue = Unwrap<ReturnType<OctokitClient["rest"]["issues"]["get"]>>["data"];
type Config = {
    changelog: {
        exclude?: {
            labels?: string[],
            authors?: string[]
        },
        categories: {
            title: string,
            labels: string[],
            exclude?: Config["changelog"]["exclude"]
        }[]
    }
}

async function run() {
    try {
        const token = process.env.GITHUB_TOKEN!;
        const client = getOctokit(token);

        const { repo: { owner, repo } } = context;

        const tag = getInput("tag_name", { required: true }).replace("refs/tags/", "");
        let prevTag = getInput("prev_tag_name")?.replace("refs/tags/", "");

        if (!prevTag) {
            info("There was no 'prev_tag_name' specified. Falling back to the latest release tag.")

            try {
                var response = await client.rest.repos.getLatestRelease({ owner, repo });
                prevTag = response.data.tag_name;
            } catch (error) {
                info("Latest published full release for the repository doesn't exist yet. All suitable related issues will be included.")
            }
        }

        const params = { owner, repo, per_page: 100 };

        let config: Config = defaultConfig;

        for (const path of getConfigPaths()) {
            try {
                const { data } = await client.rest.repos.getContent({ ...params, path });
                const content = "type" in data && data.type === "file" ? atob(data.content) : "";
                config = YAML.parse(content);
                break;
            } catch (error: any) {
                if (error.status !== 404) {
                    throw error;
                }
            }
        }

        const excludeLabels = new Set(config.changelog.exclude?.labels ?? []);
        const excludeAuthors = new Set(config.changelog.exclude?.authors?.map(a => a.toLowerCase()) ?? []);
        const excludePredicate = (label: string) => excludeLabels.has(label);

        const categories = config.changelog.categories.map(
            ({ title, labels = [], exclude: { labels: excludeLabels = [], authors: excludeAuthors = [] } = {} }) =>
            ({
                title, labels,
                excludeLabels: new Set(excludeLabels),
                excludeAuthors: new Set(excludeAuthors.map(ea => ea.toLowerCase())),
                issues: new Array<Issue>()
            }));
        const labelMappings = new Map(categories.flatMap(category => category.labels.map(label => [label, category])));
        const catchAllCategory = labelMappings.get("*");

        const fetchCommits = prevTag
            ? async function* () {
                const response = await client.rest.repos.compareCommits({ ...params, base: prevTag, head: tag });
                for (const commit of response.data.commits) {
                    yield commit;
                }
            }
            : async function* () {
                const iterator = client.paginate.iterator(client.rest.repos.listCommits, { ...params, sha: tag });
                for await (const { data } of iterator) {
                    for (const commit of data) {
                        yield commit;
                    }
                }
            }

        const re = /\B#(\d+)\b/gm;
        const issues = new Map<number, Issue>();

        for await (const { commit: { message } } of fetchCommits()) {
            const matches = message.matchAll(re);
            for (const [_, num] of matches) {
                const issueNumber = parseInt(num);
                if (!issues.has(issueNumber)) {
                    try {
                        const { data: issue } = await client.rest.issues.get({ owner, repo, issue_number: issueNumber });
                        issues.set(issueNumber, issue);
                    } catch (error) {
                        warning(`Issue #${issueNumber} cannot be found in this repository.`);
                    }
                }
            }
        }

        for (const [_, issue] of issues) {
            const { state, labels, closed_by } = issue;
            if (state === "closed") {
                const closedBy = closed_by!.login.toLowerCase();
                const lbls = labels.map(lbl => typeof lbl === "string" ? lbl : lbl.name!);

                if (lbls.some(excludePredicate) || excludeAuthors.has(closedBy)) {
                    continue;
                }

                let mapped = false;

                for (const label of lbls) {
                    const category = labelMappings.get(label);
                    if (category &&
                        !lbls.some(lbl => category.excludeLabels.has(lbl)) &&
                        !category.excludeAuthors.has(closedBy)) {
                        category.issues.push(issue);
                        mapped = true;
                    }
                }

                if (catchAllCategory && !mapped && !catchAllCategory.excludeAuthors.has(closedBy)) {
                    catchAllCategory.issues.push(issue);
                }
            }
        }

        let markup = "";
        for (const { title, issues } of categories) {
            if (issues.length === 0)
                continue;

            markup += `### ${title}\n`;

            for (const { title, number, assignee, html_url } of issues) {
                const eventIterator = client.paginate.iterator(client.rest.issues.listEvents, { ...params, issue_number: number });
                const commiters = new Set<string>();
                for await (const { data } of eventIterator) {
                    for (const { event, commit_id, actor: { login } } of data) {
                        if (commit_id && (event === "referenced" || event === "closed" || event === "commited")) {
                            commiters.add(login);
                        }
                    }
                }

                const contributors = commiters.size > 0 ? Array.from(commiters).map(c => `@${c}`).join(", ") : assignee;
                markup += ` - [${title}](${html_url}) (${contributors})\n`;
            }
        }

        setOutput("release_notes_content", markup);
    } catch (error) {
        setFailed((error as Error).message);
    }
}

function* getConfigPaths() {
    const configPath = getInput("configuration_file_path");
    if (configPath) {
        yield configPath;
    } else {
        yield ".github/release.yml";
        yield ".github/release.yaml";
    }
}

run();