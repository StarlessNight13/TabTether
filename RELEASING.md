# Releasing TabTether

Pushing to `master` runs the release workflow. It creates a published GitHub Release—never a draft—when one of the commits since the last `v*` tag uses a conventional-commit subject:

- `feat: ...` or `feat(scope): ...` creates a minor release.
- `fix: ...` or `perf: ...` creates a patch release.
- Add `!` after the type or include `BREAKING CHANGE:` in the body to create a major release.

For example, use `feat: add cloud backup restore` as a squash-merge title. Commits without one of these subjects do not create a release. Every published release includes Chrome, Firefox, and Firefox Android ZIPs, generated GitHub release notes, and the matching version in `package.json`.
