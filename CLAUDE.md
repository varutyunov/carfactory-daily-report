# Car Factory Project Notes

## CRITICAL: Git Deployment

**GitHub Pages serves from the `main` branch — NOT `master`.**

The repo has two branches: `master` (working branch) and `main` (live/deployed branch).
Git is configured with dual push refspecs so `git push` updates both automatically:
```
remote.origin.push = refs/heads/master:refs/heads/master
remote.origin.push = refs/heads/master:refs/heads/main
```

**Always push from `/c/Users/Vlad/Desktop/carfactory` (the main repo), never from a worktree.**
After pushing, verify the live site at https://carfactory.work reflects the change.

This has been missed twice — do not push only to `master`.

## Testing Rule

**Always test in preview before pushing.** Screenshot and verify functionality end-to-end.
