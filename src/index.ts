import { getInput, setFailed, setOutput } from "@actions/core";
import { context, getOctokit } from "@actions/github";
import fs from "node:fs/promises";

async function run() {
    try {
        const token = process.env.GITHUB_TOKEN!;
        const client = getOctokit(token);

        const { repo: { owner, repo } } = context;

        const tag = getInput("tag_name", { required: true }).replace("refs/tags/", "");

        setOutput("release_notes_content", "Test release notes for " + tag);
    } catch (error) {
        setFailed((error as Error).message);
    }
}

run();