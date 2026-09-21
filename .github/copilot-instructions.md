# Repository instructions

For this repository, create commits with the `ribardo0` Git identity and push with the `ribardo0` GitHub credentials, even when the Copilot environment exposes another account through `GH_TOKEN`.

Use this push form so the repository uses the `ribardo0` account stored in `gh` keyring instead of the Copilot-provided credential helper:

```powershell
git -c credential.helper= -c credential.helper='!f() { unset GH_TOKEN; gh auth git-credential "$@"; }; f' push origin main
```
