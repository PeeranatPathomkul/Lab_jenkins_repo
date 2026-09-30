# Rollback runbook — production deploy failed

**For:** the on-call engineer. **Applies to:** a `main` build of `taskflow-multibranch` that failed at `Blue/Green Deploy`, `Pipeline Health Gate` or `Deploy — Production`, or a `taskflow-mobile` `main` build that failed at `Build — Release AAB (signed)`. **Goal:** users keep being served by the last good version, within 10 minutes.

You get a ❌ e-mail (`poonsuk-api [main] #N: FAILURE`, `Failed at: <stage>`). All commands are PowerShell, run from the repository root. They use the host kubeconfig kept outside the repo:

```powershell
$env:KUBECONFIG = (Resolve-Path ..\kubeconfig-kind.yaml)
kubectl config current-context        # must print kind-taskflow
```

## 1. Find out what failed (1 min)

Open the **Build URL** from the e-mail → Console Output → search for the stage named in `Failed at:`.

| `Failed at:` | Was production touched? | Go to |
|---|---|---|
| any stage before `Blue/Green Deploy` (tests, scans, gates) | No, nothing was deployed | §6 |
| `Blue/Green Deploy` | The idle colour only. The pipeline rolls back automatically | §2 |
| `Pipeline Health Gate` | No, the deploy was blocked on purpose | §5 |
| `Deploy — Production` (input rejected / timed out) | No | §6 |
| `Build — Release AAB (signed)` (mobile) | No AAB was published | §7 |

## 2. Confirm the automatic rollback (2 min)

The Blue/Green stage's `post { failure }` points the live Service back at the previous colour and runs `kubectl rollout undo` on the colour that failed. In the console, look for:

```
ROLLBACK: deploy to <next> failed - routing traffic back to <previous>
ROLLBACK complete: live colour is <previous>
```

Check the cluster yourself:

```powershell
kubectl get svc taskflow -o jsonpath='{.spec.selector.color}'      # live colour
kubectl get deploy taskflow-blue taskflow-green -o wide             # image per colour, READY
kubectl get pods -l app=taskflow                                    # all Running, READY 1/1?
```

If the live colour is the previous one and its pods are `1/1 Running`, go to §4. If you see `ROLLBACK: failed before the live colour was read`, or the live colour is still the broken one, do §3.

## 3. Roll back by hand (3 min)

```powershell
# 1. Which colour is live, and which one is broken? (use the one whose pods are NOT ready)
kubectl get svc taskflow -o jsonpath='{.spec.selector.color}'
kubectl get pods -l app=taskflow -L color

# 2. Send traffic to the healthy colour (here: blue - replace as needed)
kubectl patch svc taskflow -p '{\"spec\":{\"selector\":{\"color\":\"blue\"}}}'

# 3. Put the broken colour back on its previous image so it is a healthy standby
kubectl rollout undo deployment/taskflow-green
kubectl rollout status deployment/taskflow-green --timeout=120s
```

If both colours are broken, redeploy a known-good image directly (find one in §5 step 2):

```powershell
kubectl set image deployment/taskflow-blue app=localhost:5000/poonsuk-api:<good-sha7>
kubectl rollout status deployment/taskflow-blue --timeout=120s
kubectl patch svc taskflow -p '{\"spec\":{\"selector\":{\"color\":\"blue\"}}}'
```

## 4. Verify the service (1 min)

```powershell
kubectl run smoke-rollback --rm -i --restart=Never --image=curlimages/curl -- curl -sf http://taskflow:8080/health
```

It must print a JSON health body and `pod "smoke-rollback" deleted`. A failure here means that §2/§3 did not work: repeat §3 with the other colour, then escalate.

## 5. Redeploy the last good version through the pipeline (5 min)

1. **Health Gate blocked the deploy?** Do not bypass it. The last builds are failing too often. Fix the failing builds (Jenkins → `taskflow-multibranch` → the red builds) and let green builds bring the success rate back to ≥ 90 %, then rebuild `main`.
2. **Find the last good image.** It is the one the live colour runs:
   ```powershell
   $live = kubectl get svc taskflow -o jsonpath='{.spec.selector.color}'
   kubectl get deploy "taskflow-$live" -o jsonpath='{.spec.template.spec.containers[0].image}'
   ```
   Or use the commit of the last green `main` build (Jenkins → `taskflow-multibranch` → `main` → Last successful build → Changes). Tags in the registry: `curl.exe -s http://127.0.0.1:5000/v2/poonsuk-api/tags/list`.
3. **Redeploy it on purpose.** Jenkins → `taskflow-multibranch` → `main` → **Build with Parameters** → `DEPLOY_IMAGE_OVERRIDE` = `localhost:5000/poonsuk-api:<good-sha7>` → Build. It re-runs the gates, deploys that image blue/green, and stops at `Deploy to production?` for an admin.
4. **Or revert the bad commit** (preferred when the bad change is known): `git revert <bad-sha>` on a branch → PR → `develop` → `main`, so the full pipeline runs on the fix.

## 6. Nothing was deployed

Production still runs the previous version. Fix the failing stage on a branch (the console names the failing test, CVE, policy message or finding), push, and let the PR build go green. No rollback is needed.

## 7. Mobile release AAB failed

No bundle was produced or archived, so nothing can reach the store. Do not upload a locally built AAB. Common causes:
- `android-keystore` / `android-keystore-password` credential missing or wrong → fix it in Manage Jenkins → Credentials, then rebuild `main`.
- `Release AAB is signed with the debug key` → the credentials were not bound. Same fix.

The last good bundle is the `app-release.aab` artifact of the last green `taskflow-mobile` → `main` build.

## 8. Close the incident

- Reply to the ❌ e-mail thread: what failed, live version (colour + image tag), actions taken.
- Open a GitHub issue with the failing build URL and the fix, and link the reverting/fixing PR.
- If the automatic rollback did not work, add that to the issue: the pipeline itself needs a fix.
