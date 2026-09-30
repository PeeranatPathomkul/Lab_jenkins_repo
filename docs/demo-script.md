# Live demo script (Lab 10, ~10 minutes)

**The change:** rooms now carry a derived `pricePerGuest` (API: `backend/src/modules/rooms/room.entity.ts`, unit-tested in `room.entity.spec.ts`), and the mobile room card shows it as `฿X / guest` (`frontend/lib/models/room.dart`, `api_room_repository.dart`, `widgets/room_card.dart`). It touches both apps, so both pipelines run.

**The bad change the gates must block:** the same feature with the rounding removed. The `Unit Test` gate fails, failFast stops the other checks, the PR check turns red, and a ❌ e-mail goes out.

## Before the demo

```powershell
docker ps --format "{{.Names}}"   # jenkins sonarqube ngrok registry taskflow-control-plane localstack prometheus docker-proxy mailpit
docker stop linux-build           # proves no static agent is used
```
Open these tabs: Jenkins (both jobs), `http://127.0.0.1:8025` (Mailpit), GitHub PR page, and a terminal with `kubectl --kubeconfig ..\kubeconfig-kind.yaml get pods -n jenkins-agents -w`.
GitHub → Settings → Branches → rule for `develop` and `main`: **Require status checks to pass** (the Jenkins check). The merge button is then blocked while a check is red.

## 1. Push the bad change (≈ 5 min of pipeline)

On `feature/price-per-guest`, in `room.entity.ts` replace the rounding line with the unrounded one:

```ts
      this.capacity > 0 ? this.pricePerNight / this.capacity : undefined;
```

```powershell
git commit -am "feat(rooms): pricePerGuest on rooms, shown on the room card"
git push -u origin feature/price-per-guest
```
Open a PR `feature/price-per-guest → develop` and **assign a reviewer**.

Narrate:
| Stage | Say |
|---|---|
| Secrets Detection | "First gate, gitleaks over the whole history, in its own pod." |
| Checks pod starts | "One pod, ten tool containers, created for this build." (point at the `kubectl -w` window) |
| Verify ∥ | "Lint, SAST, SCA, SBOM and IaC checks run side by side." |
| **Unit Test ❌** | "`rounds to 2 decimals` fails: 833.333… is not 833.33. failFast aborts the other branches, nothing is built or deployed." |
| Mail + PR | Show the ❌ e-mail in Mailpit (branch + build URL) and the red check blocking the PR merge. |

## 2. Fix it and watch it go green (≈ 15 min of pipeline; fast-forward if recorded)

Put the rounding back (`Math.round((this.pricePerNight / this.capacity) * 100) / 100`), then:

```powershell
git commit -am "fix(rooms): round pricePerGuest to 2 decimals"
git push
```

| Stage | Say |
|---|---|
| Verify ∥ → Gates ∥ | "All green. Policy Gate (OPA on the audit) and SonarQube's 70 % coverage gate run in parallel." |
| Build Image | "Kaniko builds the image in a pod and pushes `poonsuk-api:<sha7>`. No Docker daemon." |
| Image checks ∥ | "Trivy blocks HIGH/CRITICAL CVEs; at the same time Playwright tests *this* image in a pod with its own Postgres and Redis." |
| Terraform Plan | "Infra is planned on every build; applying needs a person (APPLY_INFRA + approval)." |
| Blue/Green Deploy | "New image goes to the idle colour, gets smoke-tested, then the Service switches. A failure rolls back automatically." |
| Mobile pipeline | "Analyze, tests and osv-scanner in parallel, then a debug APK (artifact)." |
| Mail | ✅ e-mails for both pipelines. |

The reviewer approves, then merge. The `develop` build runs `Deploy — Staging`.

## 3. Release: `develop → main`

Open and merge a PR `develop → main`. On the `main` builds:
- **Mobile:** `Build — Release AAB (signed)` signs with the Jenkins-stored upload key; show `aab-certificate.txt` (`CN=Poonsuk Hotel`, not `Android Debug`).
- **API:** `Pipeline Health Gate` prints `Pipeline health: X of Y builds succeeded (Z%)`. Below 90 % it **blocks the production deploy live**: "the pipeline has been failing too often to trust a release". At ≥ 90 % it continues to `Deploy to production?`, which only `admin` can approve.

If something goes wrong on stage: [rollback-runbook.md](rollback-runbook.md).
