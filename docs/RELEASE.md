Phase 1 — Start a feature branch

git checkout main
Make sure you're on main before branching, not on a stale branch from last time.


git pull origin main
Pull the latest. Branching off stale main causes painful rebases later.


git checkout -b feat/short-descriptive-name
Create + switch to a new branch. Use feat/, fix/, docs/, or chore/ prefix.


git branch --show-current
Confirm you're actually on the new branch. (You hit this once before — committed straight to main by accident.)

Phase 2 — Make changes and commit

git status
See what changed. Run before every commit.


git diff
Review the actual diff, not just the file list. Catches accidental edits.


git add path/to/file1 path/to/file2
Add specific files. Avoid git add . — it sweeps in .env, build artifacts, accidental edits.


git commit -m "feat: short summary

Longer body explaining the why, if needed."
Commit. Do not add a Claude co-author trailer. Heredoc the message if it contains apostrophes:


git commit -F /tmp/commit-msg.txt
Repeat add/commit as you make more changes on the branch.

Phase 3 — Push and open the PR

git push -u origin feat/short-descriptive-name
Push the branch and set upstream. The -u means future git push works without arguments.


gh pr create --title "feat: short title" --body "$(cat <<'EOF'
## Summary
- bullet 1
- bullet 2

## Test plan
- [ ] tests pass
- [ ] manual check of X
EOF
)"
Open the PR via GitHub CLI. The heredoc preserves formatting and apostrophes.


gh pr view --web
Open the PR in the browser to confirm it looks right.

Phase 4 — Wait for CI, then merge

gh pr checks
Show the status of all CI checks for the current branch's PR. Wait for green.


gh pr merge --squash --delete-branch
Squash-merge the PR and delete the remote branch. Use --merge instead if you want to preserve all commits.


git checkout main && git pull origin main
Switch back to main and pull the merged change.


git branch -d feat/short-descriptive-name
Delete the local branch. (Remote was deleted by --delete-branch above.)

Phase 5 — Bump the version
This is its own commit on main, no PR needed (or do a PR if your team prefers).

Decide the version per semver:

0.4.2 → 0.4.3 for bug fixes
0.4.2 → 0.5.0 for new features
0.4.2 → 1.0.0 for breaking changes

npm version patch --no-git-tag-version
# or: npm version minor --no-git-tag-version
# or: npm version major --no-git-tag-version
Bump the version in package.json. --no-git-tag-version stops npm from creating the tag automatically — you'll do it manually after updating the changelog.

Edit CHANGELOG.md to add a section for the new version. Use the existing entries as a template.


git add package.json package-lock.json CHANGELOG.md
git commit -m "chore: release v0.X.Y"
git push origin main
Commit and push the version bump.

Phase 6 — Tag and trigger the release

git tag v0.X.Y
Create the tag. The v prefix matters — your release.yml workflow looks for v* tags.


git tag -l | tail -5
Confirm the tag was created and matches package.json. The release workflow has a guard that fails if these don't match.


git push origin v0.X.Y
Push the tag. This is what triggers the release workflow. Without this push, nothing happens.


gh run watch
Watch the workflow run live. The release workflow does: build, test, push GHCR image, cosign sign, generate SBOM, publish to npm, create GitHub Release.


gh release view v0.X.Y
Confirm the GitHub Release was created with the right artifacts.

Phase 7 — Verify npm

npm view warehouse-mcp version
Confirm npm has the new version. Should match the tag you just pushed.


npm view warehouse-mcp dist-tags
Confirm latest points to the new version, not a stale one.

Phase 8 — Publish to MCP Registry

mcp-publisher login
Authenticate. Opens a browser flow. You only need to do this once per machine until the token expires.

Edit server.json to update the version field if it's hardcoded there (your manifest has the version embedded in the identifier — double check it matches).


mcp-publisher publish
Publish to the MCP Registry. Reads server.json from the current directory.


curl -s "https://registry.modelcontextprotocol.io/v0/servers?search=warehouse-mcp" | jq .
Verify the registry has the new version.

Phase 9 — Announce (optional but high-leverage)
Post the release notes on LinkedIn (link in first comment)
Update the README "Latest version" badge if you have one
If it's a notable feature, draft a short blog post following the trust+adoption theme
Tweet at Anthropic DevRel + MotherDuck DevRel if the release helps them tell a story
Common rescue commands

git branch --show-current
Always check before committing. Saves you from the "committed to main by accident" trap.


git stash && git stash pop
Park uncommitted changes if you need to switch branches quickly.


git log --oneline -10
See the last 10 commits to figure out where you are.


gh pr list --state open
List your open PRs across the repo.


gh run list --workflow=release.yml --limit 5
Show recent release workflow runs. Useful when a tag push didn't seem to trigger anything.


git tag -d v0.X.Y && git push origin :refs/tags/v0.X.Y
Delete a tag locally and on the remote — only if you pushed a wrong tag and the workflow hasn't published yet. Once npm publish has run, the version is permanent on npm; you can't reuse the number.


npm view warehouse-mcp versions --json
List every version ever published to npm. Useful to confirm what's actually out there.

The two failure modes to watch for
Tag/version mismatch. Your workflow has a guard, but if you tag v0.5.0 while package.json says 0.4.3, the release fails. Always run npm version before tagging.

Forgot to push the tag. A local tag triggers nothing. The git push origin v0.X.Y step is what kicks off the release. If CI didn't run, this is almost always why.