# create-release-notes

A GitHub Action for generating release notes based on commit messages between tags.

### Example Workflow

```yaml
name: Generate Release Notes

on:
    push:
        tags:
            - 'v*'

jobs:
    release-notes:
        runs-on: ubuntu-latest
        steps:
            - name: Generate Release Notes
                uses: Lapiniot/create-release-notes@v1
                with:
                    tag-name: ${{ github.ref }}
                env:
                    GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

### Inputs

- `tag-name` (required): The tag name for which to generate release notes.
- `prev-tag-name` (optional): The previous tag to compare against. If not provided, the action will use the latest release tag before `tag-name`.
- `configuration-file-path` (optional): Specifies a path to a file in the repository containing configuration settings used for generating the release notes. If unspecified, the configuration file located in the repository at '.github/release.yml' or '.github/release.yaml' will be used. If that is not present, the default configuration will be used.

### Outputs
- `release-notes-content`: The generated release notes content.

### Enviroment Variables
- `GITHUB_TOKEN` (required): A GitHub token with permissions to read the repository data.

## License

MIT License. See [LICENSE](LICENSE) for details.