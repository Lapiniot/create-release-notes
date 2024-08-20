import { getInput, info, setFailed, setOutput, warning } from "@actions/core";
import { context, getOctokit } from "@actions/github";
import fs from "node:fs/promises";

type Unwrap<T> = T extends Promise<infer P> ? P : T;
type ArrayType<T> = T extends Array<infer P> ? P : T;
type PageResult<T> = [data: T[], hasMore: boolean];

type OctokitClient = ReturnType<typeof getOctokit>;
type Commit = ArrayType<Unwrap<ReturnType<OctokitClient["rest"]["repos"]["listCommits"]>>["data"]>;
type Issue = Unwrap<ReturnType<OctokitClient["rest"]["issues"]["get"]>>["data"];

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

        let markup = "";
        for (let [_, { title, state, html_url, assignees }] of issues) {
            if (state === "closed") {
                const assigneesList = assignees?.map(({ login, html_url }) =>
                    `[@${login}](${html_url})`)
                    .join(", ");
                markup += ` - [${title}](${html_url}) (${assigneesList})\n`;
            }
        }

        console.log(markup);

        setOutput("release_notes_content", markup);
    } catch (error) {
        setFailed((error as Error).message);
    }
}

run();
