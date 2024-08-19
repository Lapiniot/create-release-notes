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

        const fetchCommits = (prevTag)
            ? async function (client: OctokitClient, page: number) {
                const response = await client.rest.repos.compareCommits({ owner, repo, base: prevTag, head: tag, page, per_page: 100 });
                return [response.data.commits, hasNextPage(response.headers.link)] as PageResult<Commit>;
            }
            : async function (client: OctokitClient, page: number) {
                const response = await client.rest.repos.listCommits({ owner, repo, sha: tag, page, per_page: 100 });
                return [response["data"], hasNextPage(response.headers.link)] as PageResult<Commit>;
            }

        let page = 0;
        const re = /\B#(\d+)\b/gm;
        const issues = new Map<number, Issue>();

        while (true) {
            const [commits, hasMore] = await fetchCommits(client, page++);
            for (let index = 0; index < commits.length; index++) {
                const { commit: { message } } = commits[index];
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

            if (!hasMore) break;
        }

        let markup = "";
        for (let [_, { title, state, url }] of issues) {
            if (state === "closed") {
                markup += ` - [${title}](${url})\n`;
            }
        }

        console.log(markup);

        setOutput("release_notes_content", markup);
    } catch (error) {
        setFailed((error as Error).message);
    }
}


function hasNextPage(link: string | undefined): boolean {
    return !!link && link.includes("rel=\"next\"");
}

run();
