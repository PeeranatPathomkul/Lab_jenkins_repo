pipeline {
    // No pipeline-wide agent. Lab 10: every stage that does work runs on a
    // Kubernetes dynamic agent - a pod in the kind cluster (cloud `kind`,
    // namespace jenkins-agents) created for that stage and deleted after it,
    // from the pod templates in ci/k8s/. Nothing runs on the static,
    // hand-provisioned linux-build agent any more. Stages that only wait
    // (Quality Gate, Approval, the production input) hold no pod while waiting.
    agent none

    environment {
        APP_NAME = 'poonsuk-api'
        NODE_ENV = 'test'
        // Lab 10: who gets the success/failure e-mail (see notifyBuild below).
        NOTIFY_EMAIL = 'dev-team@poonsuk.lab'
    }

    parameters {
        // Lab 07 fault injection: deploy a known-broken image to prove the
        // automatic blue/green rollback. Empty (the default, and what every
        // webhook-triggered build uses) deploys the image this run built and
        // scanned. Never set it outside the lab: it bypasses the Trivy gate.
        string(
            name: 'DEPLOY_IMAGE_OVERRIDE',
            defaultValue: '',
            description: 'Lab 07 only: image to deploy instead of this build\'s image (leave empty)'
        )
        // Lab 08: Terraform is planned on every build, but only a person can
        // start an apply: tick this in "Build with Parameters", then approve
        // the plan at the Approval stage. Webhook builds never apply.
        booleanParam(
            name: 'APPLY_INFRA',
            defaultValue: false,
            description: 'Lab 08: after the Terraform plan, ask for approval and apply it'
        )
    }

    stages {
        stage('Secrets Detection') {
            // Shift-left: the first gate, before anything is installed or built.
            // A leaked credential is cheapest to fix here, before it spreads.
            // Lab 10: kept on its own ahead of the parallel Verify block - it
            // takes seconds, and nothing should run on a commit that leaks one.
            agent {
                kubernetes {
                    cloud 'kind'
                    yamlFile 'ci/k8s/gitleaks.yaml'
                    defaultContainer 'gitleaks'
                }
            }
            options {
                // Includes starting the pod (and pulling gitleaks the first time).
                timeout(time: 10, unit: 'MINUTES')
            }
            steps {
                script { env.CURRENT_STAGE = env.STAGE_NAME }
                // `gitleaks git` walks the full commit history of the checked-out
                // branch (git log -p), not just the current files. Exits 1 on any
                // finding, which fails the stage and stops the pipeline here.
                // --redact keeps the secret value itself out of the log/report.
                sh 'gitleaks git . --no-banner --redact --verbose --report-format json --report-path gitleaks-report.json'
            }
            post {
                always {
                    archiveArtifacts artifacts: 'gitleaks-report.json', allowEmptyArchive: true
                }
            }
        }

        stage('API pipeline') {
            // Lab 10 (monorepo): a push runs both this job and taskflow-mobile.
            // When it only touches the Flutter app (frontend/**), everything
            // below is skipped, so the two heavy pipelines do not compete for
            // the one Docker host. Secrets Detection above still runs on every
            // push; its checkout is also what records the change list read here.
            when {
                anyOf {
                    // Any changed path outside frontend/ (backend, e2e, infra,
                    // policy, k8s, this Jenkinsfile...).
                    changeset pattern: '^(?!frontend/).*', comparator: 'REGEXP'
                    // No change list to judge by (first build of a branch, a
                    // rebuild): run everything rather than guess.
                    expression { currentBuild.changeSets.isEmpty() }
                    // Build Now always runs the full pipeline.
                    triggeredBy 'UserIdCause'
                }
            }
            stages {
                stage('Checks') {
                    // Everything that needs only the source runs in ONE pod
                    // (ci/k8s/checks.yaml: node, semgrep, syft, cosign, opa,
                    // terraform, ansible-lint, tfsec, checkov, sonar-scanner), each
                    // tool in its own container over one shared workspace - so
                    // audit.json and the coverage report need no stash/unstash.
                    agent {
                        kubernetes {
                            cloud 'kind'
                            yamlFile 'ci/k8s/checks.yaml'
                            defaultContainer 'node'
                        }
                    }
                    options {
                        // Covers the pod start too: the first run pulls every tool
                        // image onto the kind node. Each check has its own limit.
                        timeout(time: 40, unit: 'MINUTES')
                    }
                    stages {
                        stage('Verify') {
                            // Lab 10: every check that needs nothing but the commit runs side by
                            // side - lint + unit tests, SAST, SCA, SBOM and the IaC checks. None
                            // uses another's output, so none has to wait for another. failFast:
                            // the first branch to fail aborts the others, so a bad commit is
                            // reported as soon as the quickest failing check finishes.
                            // (A critical CVE in SCA is caught with catchError, so it does not
                            // abort the rest; the Policy Gate right after stops the build.)
                            // Branches record CURRENT_STAGE in post.failure instead of at the
                            // start: set at the start, it would just name the branch that began
                            // last, not the one that failed.
                            failFast true
                            parallel {
                                stage('Lint & Unit Test') {
                                    // Install -> Lint -> SAST — ESLint -> Unit Test stay in order:
                                    // all of them need the node_modules that Install creates.
                                    options {
                                        // A pipeline stage must never run unbounded: a hung `npm ci`
                                        // (registry or network stall) or a test that never exits (open
                                        // DB/Redis handle, Jest left in watch mode) would hold the agent
                                        // forever, and every later build would silently queue behind
                                        // the stuck one. Aborting after 10 minutes frees it and turns an
                                        // invisible hang into a visible failed build. A normal run takes
                                        // about 1-2 minutes, so 10 minutes leaves plenty of headroom
                                        // without hiding real problems.
                                        // (Lab 04: scoped to the CI stages rather than the whole pipeline,
                                        // so the production approval below is not killed after 10 minutes.)
                                        timeout(time: 10, unit: 'MINUTES')
                                    }
                                    stages {
                                        stage('Install') {
                                            steps {
                                                // Inside the pipeline-level post block env.STAGE_NAME is
                                                // always "Declarative: Post Actions", so each stage records
                                                // its own name here for the failure message.
                                                script { env.CURRENT_STAGE = env.STAGE_NAME }
                                                echo "Building ${env.APP_NAME} with NODE_ENV=${env.NODE_ENV}"
                                                sh 'echo "Shell sees APP_NAME=$APP_NAME NODE_ENV=$NODE_ENV"'
                                                dir('backend') {
                                                    sh 'npm ci'
                                                }
                                            }
                                        }
                                        stage('Lint') {
                                            steps {
                                                script { env.CURRENT_STAGE = env.STAGE_NAME }
                                                dir('backend') {
                                                    sh 'npm run lint'
                                                }
                                            }
                                        }
                                        stage('SAST — ESLint') {
                                            // Static analysis of our own code for insecure patterns.
                                            steps {
                                                script { env.CURRENT_STAGE = env.STAGE_NAME }
                                                dir('backend') {
                                                    // Manual: `npx eslint --plugin security src/`. ESLint 9 has no
                                                    // --plugin flag, so eslint.security.config.mjs loads
                                                    // eslint-plugin-security instead. Findings are warnings: they
                                                    // are reported (log + SARIF), not build-breaking.
                                                    sh 'npx eslint -c eslint.security.config.mjs src/'
                                                    sh 'mkdir -p reports && npx eslint -c eslint.security.config.mjs src/ -f @microsoft/eslint-formatter-sarif -o reports/eslint-security.sarif'
                                                }
                                            }
                                            post {
                                                always {
                                                    archiveArtifacts artifacts: 'backend/reports/eslint-security.sarif', allowEmptyArchive: true
                                                }
                                            }
                                        }
                                        stage('Unit Test') {
                                            steps {
                                                script { env.CURRENT_STAGE = env.STAGE_NAME }
                                                dir('backend') {
                                                    // `default` keeps Jest's console summary in the log;
                                                    // jest-junit writes backend/reports/junit.xml.
                                                    sh 'npm test -- --coverage --reporters=default --reporters=jest-junit'
                                                }
                                            }
                                            post {
                                                always {
                                                    // Publish even when tests fail, so the red build still
                                                    // shows which tests broke and feeds the trend graph.
                                                    junit 'backend/reports/junit.xml'
                                                    // publishCoverage/coberturaAdapter (Code Coverage API
                                                    // plugin) is deprecated; recordCoverage from the
                                                    // Coverage plugin reads the same Cobertura XML.
                                                    recordCoverage(
                                                        tools: [[parser: 'COBERTURA', pattern: 'backend/coverage/cobertura-coverage.xml']],
                                                        sourceDirectories: [[path: 'backend/src']],
                                                        id: 'unit-coverage',
                                                        name: 'Unit Test Coverage'
                                                    )
                                                }
                                            }
                                        }
                                    }
                                    post {
                                        always {
                                            archiveArtifacts artifacts: '**/npm-debug.log*', allowEmptyArchive: true
                                        }
                                    }
                                }

                                stage('SAST — Semgrep') {
                                    options {
                                        timeout(time: 10, unit: 'MINUTES')
                                    }
                                    steps {
                                        container('semgrep') {
                                            // OWASP Top 10 + Node.js rule packs from the Semgrep Registry.
                                            // One run prints the summary to the log and writes SARIF.
                                            // Semgrep exits 0 even with findings (no --error), so like ESLint
                                            // this stage reports; blocking lives in SCA and the Policy Gate.
                                            sh 'semgrep scan --config=p/owasp-top-ten --config=p/nodejs --metrics=off --sarif-output=semgrep.sarif backend/src'
                                        }
                                    }
                                    post {
                                        always {
                                            archiveArtifacts artifacts: 'semgrep.sarif', allowEmptyArchive: true
                                        }
                                        failure {
                                            script { env.CURRENT_STAGE = env.STAGE_NAME }
                                        }
                                    }
                                }

                                stage('SCA — npm audit') {
                                    // Software Composition Analysis: known CVEs in third-party packages,
                                    // read straight from package-lock.json (--package-lock-only: no
                                    // install needed, and it never touches the node_modules that
                                    // Install is writing next door).
                                    options {
                                        timeout(time: 5, unit: 'MINUTES')
                                    }
                                    steps {
                                        dir('backend') {
                                            // npm audit exits non-zero whenever anything >= high exists;
                                            // `|| true` hands the verdict to the threshold logic below
                                            // instead of that exit code.
                                            sh 'npm audit --package-lock-only --audit-level=high --json > audit.json || true'
                                            script {
                                                // node:20-alpine has no jq, so read the counts with node.
                                                def count = { String level ->
                                                    sh(
                                                        script: "node -p \"require('./audit.json').metadata.vulnerabilities.${level}\"",
                                                        returnStdout: true
                                                    ).trim().toInteger()
                                                }
                                                def critical = count('critical')
                                                def high = count('high')
                                                echo "SCA summary: critical=${critical}, high=${high}, moderate=${count('moderate')}, low=${count('low')}"

                                                if (critical > 0) {
                                                    // FAIL: marks this stage and the build as FAILURE, but
                                                    // does not abort the other Verify branches, and lets the
                                                    // pipeline reach the Policy Gate, which is the stage
                                                    // that actually stops it before any build.
                                                    catchError(buildResult: 'FAILURE', stageResult: 'FAILURE') {
                                                        error("Blocking: ${critical} critical vulnerabilities found")
                                                    }
                                                } else if (high > 0) {
                                                    // WARN: visible in the log, but not build-breaking.
                                                    echo "WARNING: ${high} high vulnerabilities (allowed; fix when a patch is available)"
                                                    echo 'SCA passed with 0 critical vulnerabilities (warnings allowed)'
                                                } else {
                                                    echo 'SCA passed with 0 critical vulnerabilities (warnings allowed)'
                                                }
                                            }
                                        }
                                    }
                                    post {
                                        always {
                                            archiveArtifacts artifacts: 'backend/audit.json', allowEmptyArchive: true
                                        }
                                        failure {
                                            script { env.CURRENT_STAGE = env.STAGE_NAME }
                                        }
                                    }
                                }

                                stage('Generate SBOM') {
                                    options {
                                        timeout(time: 10, unit: 'MINUTES')
                                    }
                                    environment {
                                        SBOM = 'sbom/poonsuk-api.cdx.json'
                                    }
                                    steps {
                                        sh 'mkdir -p sbom'
                                        container('syft') {
                                            // CycloneDX SBOM of backend/ (package-lock.json -> every npm
                                            // package and version), tagged with the commit it describes.
                                            // node_modules is excluded: Install may be filling it right
                                            // now, and the lockfile already lists every package.
                                            // The binary is /syft (not on the image's PATH).
                                            sh '''
                                                /syft scan dir:backend --exclude './node_modules/**' \
                                                  --source-name poonsuk-api --source-version "$GIT_COMMIT" \
                                                  -o cyclonedx-json="$SBOM"
                                            '''
                                        }
                                        // Sign with the lab's local Cosign key pair. The private key and
                                        // its password come only from Jenkins credentials. No
                                        // transparency-log upload: the lab key is not a public identity.
                                        withCredentials([
                                            file(credentialsId: 'cosign-key', variable: 'COSIGN_KEY'),
                                            string(credentialsId: 'cosign-password', variable: 'COSIGN_PASSWORD'),
                                        ]) {
                                            container('cosign') {
                                                sh '''
                                                    cosign sign-blob --yes --key "$COSIGN_KEY" \
                                                      --use-signing-config=false --new-bundle-format=false --tlog-upload=false \
                                                      --output-signature "$SBOM.sig" "$SBOM"
                                                '''
                                            }
                                        }
                                        container('cosign') {
                                            // Prove the signature matches the committed public key.
                                            sh 'cosign verify-blob --key cosign.pub --signature "$SBOM.sig" --insecure-ignore-tlog=true "$SBOM"'
                                        }
                                    }
                                    post {
                                        always {
                                            archiveArtifacts artifacts: 'sbom/poonsuk-api.cdx.json, sbom/poonsuk-api.cdx.json.sig', allowEmptyArchive: true
                                        }
                                        failure {
                                            script { env.CURRENT_STAGE = env.STAGE_NAME }
                                        }
                                    }
                                }

                                stage('Terraform Validate') {
                                    // Static checks on the infrastructure code, before any plan. The
                                    // terraform container has its own .terraform dir (TF_DATA_DIR) and
                                    // the provider cache on the kind node (ci/k8s/checks.yaml).
                                    options {
                                        timeout(time: 10, unit: 'MINUTES')
                                    }
                                    steps {
                                        container('terraform') {
                                            dir('infra/terraform') {
                                                // -backend=false: validation needs the providers,
                                                // not the remote state.
                                                sh 'terraform init -backend=false -input=false'
                                                sh 'terraform validate'
                                                sh 'terraform fmt -check -recursive'
                                            }
                                        }
                                    }
                                    post {
                                        failure {
                                            script { env.CURRENT_STAGE = env.STAGE_NAME }
                                        }
                                    }
                                }

                                stage('Ansible Lint') {
                                    options {
                                        timeout(time: 10, unit: 'MINUTES')
                                    }
                                    steps {
                                        container('ansible-lint') {
                                            sh 'ansible-lint infra/ansible/playbook.yml'
                                        }
                                    }
                                    post {
                                        failure {
                                            script { env.CURRENT_STAGE = env.STAGE_NAME }
                                        }
                                    }
                                }

                                stage('IaC Security Scan') {
                                    // Misconfiguration scan of the Terraform code with two independent
                                    // tools, before any plan. Both always run (so both reports exist);
                                    // the stage fails if either reports a finding.
                                    options {
                                        timeout(time: 10, unit: 'MINUTES')
                                    }
                                    steps {
                                        sh 'mkdir -p reports/iac'
                                        script {
                                            def tfsec = 0
                                            def checkov = 0
                                            container('tfsec') {
                                                // tfsec: SARIF report (never fails), then the gate run whose
                                                // table goes to the log and whose exit code counts.
                                                sh 'tfsec infra/terraform --no-color --soft-fail --format sarif --out reports/iac/tfsec.sarif'
                                                tfsec = sh(returnStatus: true, script: 'tfsec infra/terraform --no-color')
                                            }
                                            container('checkov') {
                                                // checkov: one run prints to the log and writes SARIF.
                                                checkov = sh(returnStatus: true, script: '''
                                                    checkov -d infra/terraform --framework terraform --compact \
                                                      -o cli -o sarif --output-file-path console,reports/iac/checkov.sarif
                                                ''')
                                            }
                                            echo "IaC Security Scan: tfsec exit=${tfsec}, checkov exit=${checkov}"
                                            if (tfsec != 0 || checkov != 0) {
                                                error('IaC Security Scan: misconfigurations found by tfsec and/or checkov (see reports above)')
                                            }
                                            echo 'IaC Security Scan: no findings from tfsec or checkov'
                                        }
                                    }
                                    post {
                                        always {
                                            archiveArtifacts artifacts: 'reports/iac/*.sarif', allowEmptyArchive: true
                                        }
                                        failure {
                                            script { env.CURRENT_STAGE = env.STAGE_NAME }
                                        }
                                    }
                                }
                            }
                        }

                        stage('Gates') {
                            // The Policy Gate reads the SCA report; SonarQube reads the
                            // sources + the coverage from Unit Test. Neither uses the
                            // other's output, so they run side by side. Analysis ->
                            // Quality Gate stays in order (the gate waits for that
                            // analysis).
                            failFast true
                            parallel {
                                stage('Policy Gate') {
                                    // The last security gate before any build: OPA decides, from the
                                    // SCA report, whether this commit may continue. Unlike the SCA
                                    // stage, a deny here stops the pipeline outright.
                                    options {
                                        timeout(time: 5, unit: 'MINUTES')
                                    }
                                    steps {
                                        container('opa') {
                                            // Unit tests for the policy itself (policy/security_test.rego).
                                            sh 'opa test policy/ -v'
                                            script {
                                                // --fail-defined: exit non-zero if any deny message exists.
                                                // A missing/unreadable audit.json also exits non-zero, so the
                                                // gate fails closed.
                                                def status = sh(returnStatus: true, script: '''
                                                    opa eval --fail-defined --format pretty \
                                                      --data policy/security.rego --input backend/audit.json \
                                                      "data.security.deny[msg]"
                                                ''')
                                                if (status != 0) {
                                                    error('Policy Gate: build denied by policy/security.rego (see deny messages above)')
                                                }
                                                echo 'Policy Gate: allowed - no CRITICAL vulnerabilities in the dependency scan'
                                            }
                                        }
                                    }
                                    post {
                                        failure {
                                            script { env.CURRENT_STAGE = env.STAGE_NAME }
                                        }
                                    }
                                }

                                stage('SonarQube') {
                                    stages {
                                        stage('SonarQube Analysis') {
                                            // http://sonarqube:9000 is reached over the kind network.
                                            options {
                                                // Never let a stuck upload hold the pod.
                                                timeout(time: 10, unit: 'MINUTES')
                                            }
                                            steps {
                                                // Injects SONAR_HOST_URL and the sonar-token credential configured
                                                // under Manage Jenkins -> System -> SonarQube servers.
                                                withSonarQubeEnv('SonarQube') {
                                                    container('sonar-scanner') {
                                                        dir('backend') {
                                                            // Project key, sources and coverage path live in
                                                            // backend/sonar-project.properties.
                                                            sh 'sonar-scanner'
                                                        }
                                                    }
                                                }
                                            }
                                            post {
                                                failure {
                                                    script { env.CURRENT_STAGE = env.STAGE_NAME }
                                                }
                                            }
                                        }

                                        stage('Quality Gate') {
                                            // waitForQualityGate only waits for SonarQube's webhook.
                                            steps {
                                                timeout(time: 5, unit: 'MINUTES') {
                                                    waitForQualityGate abortPipeline: true
                                                }
                                            }
                                            post {
                                                failure {
                                                    script { env.CURRENT_STAGE = env.STAGE_NAME }
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }

                stage('Build Image') {
                    // Package the API that passed every gate above into an immutable,
                    // commit-tagged image in the local registry. Never `latest`: a tag
                    // must always mean the same bits, so a deploy or rollback is exact.
                    // Lab 10: built by Kaniko in a pod - no Docker daemon involved.
                    agent {
                        kubernetes {
                            cloud 'kind'
                            yamlFile 'ci/k8s/kaniko.yaml'
                            defaultContainer 'kaniko'
                        }
                    }
                    options {
                        timeout(time: 20, unit: 'MINUTES')
                    }
                    steps {
                        script {
                            env.CURRENT_STAGE = env.STAGE_NAME
                            // Pods push to and scan registry:5000 (the registry
                            // container on the kind network); the cluster pulls the
                            // same repository as localhost:5000 through the kind
                            // node's registry mirror (Lab 07), so deploys use IMAGE.
                            env.IMAGE_TAG = env.GIT_COMMIT.take(7)
                            env.IMAGE = "localhost:5000/poonsuk-api:${env.IMAGE_TAG}"
                        }
                        sh '''
                            # Immutability: a commit's tag is pushed once and never
                            # overwritten; a re-run of the same commit reuses it.
                            if wget -qO- http://registry:5000/v2/poonsuk-api/tags/list | grep -q "\\"$IMAGE_TAG\\""; then
                                echo "poonsuk-api:$IMAGE_TAG already in the registry - not rebuilding or overwriting it"
                                exit 0
                            fi
                            # --cache-repo: layers (npm ci, the build stage) are
                            # reused from the registry, so an unchanged
                            # package-lock.json does not reinstall everything.
                            /kaniko/executor \
                              --context "dir://$WORKSPACE/backend" \
                              --dockerfile "$WORKSPACE/backend/Dockerfile" \
                              --target production \
                              --destination "registry:5000/poonsuk-api:$IMAGE_TAG" \
                              --label "org.opencontainers.image.revision=$GIT_COMMIT" \
                              --label "org.opencontainers.image.source=$GIT_URL" \
                              --insecure-registry=registry:5000 \
                              --cache=true --cache-repo=registry:5000/poonsuk-api-cache \
                              --snapshot-mode=redo --compressed-caching=false
                        '''
                        // Show what the registry now holds for this repository.
                        sh 'wget -qO- http://registry:5000/v2/poonsuk-api/tags/list; echo'
                    }
                }

                stage('Image checks') {
                    // Both check the image that was just pushed, and neither needs
                    // the other: the vulnerability scan and the end-to-end tests
                    // run side by side. Deployment waits for both.
                    failFast true
                    parallel {
                        stage('Container Scan') {
                            // Scan the exact image that was just pushed (by its commit tag),
                            // OS packages and node_modules alike, before anything deploys it.
                            agent {
                                kubernetes {
                                    cloud 'kind'
                                    yamlFile 'ci/k8s/trivy.yaml'
                                    defaultContainer 'trivy'
                                }
                            }
                            options {
                                timeout(time: 15, unit: 'MINUTES')
                            }
                            steps {
                                // 1) SARIF report, always written (exit 0), so it can be
                                //    archived whether or not the gate below passes.
                                sh 'trivy image --scanners vuln --severity HIGH,CRITICAL --format sarif --output trivy.sarif "registry:5000/poonsuk-api:$IMAGE_TAG"'
                                // 2) The gate: any HIGH or CRITICAL finding exits 1 and fails the
                                //    build before deployment. Same scan (DB is cached), printed
                                //    as a table for the log.
                                sh 'trivy image --scanners vuln --severity HIGH,CRITICAL --exit-code 1 --format table "registry:5000/poonsuk-api:$IMAGE_TAG"'
                            }
                            post {
                                always {
                                    archiveArtifacts artifacts: 'trivy.sarif', allowEmptyArchive: true
                                }
                                failure {
                                    script { env.CURRENT_STAGE = env.STAGE_NAME }
                                }
                            }
                        }

                        stage('E2E') {
                            // Lab 10: the end-to-end suite now tests the image that will be
                            // deployed, in one pod: throwaway Postgres + Redis, the API
                            // container from the image just pushed, and Playwright. Containers
                            // in a pod share localhost, so the API is http://127.0.0.1:3000.
                            // The throwaway database trusts local connections (no password),
                            // and the JWT signing key is random per run - no secret appears in
                            // this file.
                            agent {
                                kubernetes {
                                    cloud 'kind'
                                    defaultContainer 'playwright'
                                    yaml """
                                        apiVersion: v1
                                        kind: Pod
                                        spec:
                                          containers:
                                            - name: postgres
                                              image: postgres:16-alpine
                                              env:
                                                - { name: POSTGRES_USER, value: poonsuk }
                                                - { name: POSTGRES_DB, value: poonsuk }
                                                - { name: POSTGRES_HOST_AUTH_METHOD, value: trust }
                                            - name: redis
                                              image: redis:7-alpine
                                            - name: api
                                              image: ${env.IMAGE}
                                              workingDir: /app
                                              command: ["sh", "-c"]
                                              args:
                                                - |
                                                  cd /app
                                                  until nc -z 127.0.0.1 5432; do sleep 1; done
                                                  node node_modules/typeorm/cli.js migration:run -d dist/config/data-source.js
                                                  node dist/database/seed-users.js
                                                  node dist/database/seed-rooms.js
                                                  export JWT_ACCESS_SECRET="\$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \\n')"
                                                  exec node dist/main.js
                                              env:
                                                - { name: NODE_ENV, value: production }
                                                - { name: PORT, value: "3000" }
                                                - { name: DB_HOST, value: 127.0.0.1 }
                                                - { name: DB_PORT, value: "5432" }
                                                - { name: DB_NAME, value: poonsuk }
                                                - { name: DB_USER, value: poonsuk }
                                                - { name: REDIS_URL, value: "redis://127.0.0.1:6379" }
                                                - { name: UPLOAD_DIR, value: /tmp/uploads }
                                            - name: playwright
                                              image: mcr.microsoft.com/playwright:v1.63.0-noble
                                              command: ["cat"]
                                              tty: true
                                              env:
                                                - { name: HOME, value: /tmp }
                                                - { name: npm_config_cache, value: /tmp/.npm }
                                                - { name: CI, value: "true" }
                                                - { name: E2E_BASE_URL, value: "http://127.0.0.1:3000" }
                                    """
                                }
                            }
                            options {
                                // Includes pulling the Playwright image the first time.
                                timeout(time: 20, unit: 'MINUTES')
                            }
                            steps {
                                // Wait for migrations + seeds + boot: /health/ready pings the DB.
                                timeout(time: 3, unit: 'MINUTES') {
                                    sh '''
                                        until node -e "fetch('http://127.0.0.1:3000/health/ready').then(r => process.exit(r.ok ? 0 : 1), () => process.exit(1))"; do
                                            sleep 2
                                        done
                                    '''
                                }
                                dir('e2e') {
                                    sh 'npm ci'
                                    sh 'npx playwright test'
                                }
                            }
                            post {
                                always {
                                    junit allowEmptyResults: true, testResults: 'e2e/results/junit.xml'
                                    publishHTML(target: [
                                        reportName: 'Playwright Report',
                                        reportDir: 'e2e/playwright-report',
                                        reportFiles: 'index.html',
                                        keepAll: true,
                                        alwaysLinkToLastBuild: true,
                                        allowMissing: true,
                                    ])
                                    archiveArtifacts artifacts: 'e2e/playwright-report/**', allowEmptyArchive: true
                                }
                                unsuccessful {
                                    // The API's own log (migrations, boot errors).
                                    containerLog 'api'
                                }
                                failure {
                                    script { env.CURRENT_STAGE = env.STAGE_NAME }
                                }
                            }
                        }
                    }
                }

                stage('Terraform Plan') {
                    // Plan the environment (LocalStack + host container) against the
                    // remote S3 state. Read-only: it runs on every branch build and
                    // records what an apply would change.
                    when {
                        beforeAgent true
                        not { changeRequest() }
                    }
                    agent {
                        kubernetes {
                            cloud 'kind'
                            yamlFile 'ci/k8s/terraform.yaml'
                            defaultContainer 'terraform'
                        }
                    }
                    options {
                        timeout(time: 10, unit: 'MINUTES')
                    }
                    steps {
                        script { env.CURRENT_STAGE = env.STAGE_NAME }
                        // LocalStack's dummy keys still live in Jenkins credentials, so the
                        // Jenkinsfile has no literal credentials (Lab 10 checklist).
                        withCredentials([usernamePassword(credentialsId: 'localstack-aws',
                                usernameVariable: 'AWS_ACCESS_KEY_ID', passwordVariable: 'AWS_SECRET_ACCESS_KEY')]) {
                            dir('infra/terraform') {
                                sh 'terraform init -input=false'
                                script {
                                    // -detailed-exitcode: 0 = no changes, 2 = changes, 1 = error.
                                    // Output goes to plan.log first so the exit code is
                                    // terraform's own (busybox sh has no PIPESTATUS).
                                    def rc = sh(returnStatus: true, script: '''
                                        terraform plan -input=false -no-color -detailed-exitcode -out=tfplan \
                                          -var "ssh_public_key=$(cat ../ansible/ansible.pub)" > plan.log 2>&1
                                    ''')
                                    sh 'cat plan.log'
                                    if (rc == 1) {
                                        error('Terraform Plan failed (see output above)')
                                    }
                                    env.TF_PLAN_HAS_CHANGES = (rc == 2) ? 'true' : 'false'
                                    env.TF_PLAN_SUMMARY = sh(
                                        script: "grep -E '^(Plan:|No changes)' plan.log | head -1",
                                        returnStdout: true
                                    ).trim()
                                    echo "Terraform plan summary: ${env.TF_PLAN_SUMMARY}"
                                }
                                sh 'terraform show -no-color tfplan > tfplan.txt'
                                stash name: 'tfplan', includes: 'tfplan'
                            }
                        }
                    }
                    post {
                        always {
                            // The binary plan (what Apply will execute) and a readable copy.
                            archiveArtifacts artifacts: 'infra/terraform/tfplan, infra/terraform/tfplan.txt', allowEmptyArchive: true
                        }
                    }
                }

                stage('Approval') {
                    // A person must approve the exact plan above. No agent: waiting for
                    // the click holds no pod.
                    when {
                        beforeAgent true
                        allOf {
                            not { changeRequest() }
                            expression { params.APPLY_INFRA }
                            environment name: 'TF_PLAN_HAS_CHANGES', value: 'true'
                        }
                    }
                    options {
                        timeout(time: 30, unit: 'MINUTES')
                    }
                    steps {
                        script {
                            env.CURRENT_STAGE = env.STAGE_NAME
                            input(
                                message: "Apply this Terraform plan?\n\n${env.TF_PLAN_SUMMARY}\n\nFull plan: ${env.BUILD_URL}artifact/infra/terraform/tfplan.txt",
                                ok: 'Apply',
                                submitter: 'admin'
                            )
                        }
                    }
                }

                stage('Terraform Apply') {
                    // Applies exactly the approved plan file; if the state moved since
                    // the plan, Terraform refuses the stale plan instead of guessing.
                    // Also runs (without applying) when the plan had no changes, so the
                    // outputs and the Ansible inventory are always produced.
                    when {
                        beforeAgent true
                        allOf {
                            not { changeRequest() }
                            expression { params.APPLY_INFRA }
                        }
                    }
                    agent {
                        kubernetes {
                            cloud 'kind'
                            yamlFile 'ci/k8s/terraform.yaml'
                            defaultContainer 'terraform'
                        }
                    }
                    options {
                        timeout(time: 15, unit: 'MINUTES')
                    }
                    steps {
                        script { env.CURRENT_STAGE = env.STAGE_NAME }
                        withCredentials([usernamePassword(credentialsId: 'localstack-aws',
                                usernameVariable: 'AWS_ACCESS_KEY_ID', passwordVariable: 'AWS_SECRET_ACCESS_KEY')]) {
                            dir('infra/terraform') {
                                unstash 'tfplan'
                                sh 'terraform init -input=false'
                                script {
                                    if (env.TF_PLAN_HAS_CHANGES == 'true') {
                                        sh 'terraform apply -input=false -no-color tfplan'
                                    } else {
                                        echo 'Plan had no changes - nothing to apply'
                                    }
                                }
                                sh 'terraform output -no-color'
                                sh 'terraform output -json > outputs.json'
                                // Dynamic Ansible inventory, generated from Terraform's
                                // outputs on every run (the host address is not fixed).
                                sh '''
                                    printf '[app]\\n%s ansible_host=%s ansible_user=ansible\\n' \
                                      "$(terraform output -raw instance_hostname)" \
                                      "$(terraform output -raw instance_address)" > ../ansible/inventory.ini
                                    cat ../ansible/inventory.ini
                                '''
                            }
                            stash name: 'ansible-inventory', includes: 'infra/ansible/inventory.ini'
                        }
                    }
                    post {
                        always {
                            archiveArtifacts artifacts: 'infra/terraform/outputs.json, infra/ansible/inventory.ini', allowEmptyArchive: true
                        }
                    }
                }

                stage('Configure with Ansible') {
                    // Configure the host Terraform just provisioned: Node.js, Docker,
                    // and this build's scanned API image (by commit tag).
                    when {
                        beforeAgent true
                        allOf {
                            not { changeRequest() }
                            expression { params.APPLY_INFRA }
                        }
                    }
                    agent {
                        kubernetes {
                            cloud 'kind'
                            yamlFile 'ci/k8s/ansible.yaml'
                            defaultContainer 'ansible'
                        }
                    }
                    options {
                        timeout(time: 20, unit: 'MINUTES')
                    }
                    steps {
                        script { env.CURRENT_STAGE = env.STAGE_NAME }
                        unstash 'ansible-inventory'
                        // The private key lives only in Jenkins credentials; the host
                        // trusts its public half (infra/ansible/ansible.pub via Terraform).
                        withCredentials([sshUserPrivateKey(credentialsId: 'ansible-ssh',
                                keyFileVariable: 'SSH_KEY', usernameVariable: 'SSH_USER')]) {
                            sh '''
                                ansible-playbook -i infra/ansible/inventory.ini \
                                  --private-key "$SSH_KEY" -u "$SSH_USER" \
                                  -e app_image="registry:5000/poonsuk-api:$IMAGE_TAG" \
                                  infra/ansible/playbook.yml
                            '''
                        }
                    }
                }

                stage('Blue/Green Deploy') {
                    // Deploy the scanned image to the idle colour in the kind cluster,
                    // smoke-test it there, then flip the live Service's selector.
                    // Lab scope: runs for every branch build (not PR builds) against the
                    // single local cluster; a real pipeline would limit this to main.
                    when {
                        beforeAgent true
                        not { changeRequest() }
                    }
                    agent {
                        kubernetes {
                            cloud 'kind'
                            yamlFile 'ci/k8s/kubectl.yaml'
                            defaultContainer 'kubectl'
                        }
                    }
                    options {
                        timeout(time: 10, unit: 'MINUTES')
                    }
                    steps {
                        script { env.CURRENT_STAGE = env.STAGE_NAME }
                        // kubeconfig for the kind cluster (internal API server address)
                        // comes only from Jenkins credentials.
                        withCredentials([file(credentialsId: 'kubeconfig-kind', variable: 'KUBECONFIG')]) {
                            script {
                                def current = sh(
                                    script: "kubectl get svc taskflow -o jsonpath='{.spec.selector.color}'",
                                    returnStdout: true
                                ).trim()
                                def next = current == 'blue' ? 'green' : 'blue'
                                // Remembered for the automatic rollback in post.failure.
                                env.BG_PREVIOUS = current
                                env.BG_NEXT = next

                                def override = params.DEPLOY_IMAGE_OVERRIDE?.trim()
                                def image = override ?: env.IMAGE
                                if (override) {
                                    echo "FAULT INJECTION: deploying ${override} instead of ${env.IMAGE}"
                                }
                                echo "Live colour: ${current}. Deploying ${image} to ${next}."

                                // Service before the switch (Lab 07 deliverable).
                                sh 'kubectl get svc taskflow -o yaml'

                                sh "kubectl set image deployment/taskflow-${next} app=${image}"
                                sh "kubectl rollout status deployment/taskflow-${next} --timeout=120s"

                                // Smoke test the new pods directly through their own
                                // Service (taskflow-<colour>), bypassing the live one.
                                sh "kubectl run smoke-${env.IMAGE_TAG}-${env.BUILD_NUMBER} --rm -i --restart=Never --image=curlimages/curl -- curl -sf http://taskflow-${next}:8080/health"

                                sh """kubectl patch svc taskflow -p '{"spec":{"selector":{"color":"${next}"}}}'"""
                                echo "Switched traffic from ${current} to ${next}"

                                // Service after the switch (Lab 07 deliverable).
                                sh 'kubectl get svc taskflow -o yaml'
                            }
                        }
                    }
                    post {
                        failure {
                            // Automatic rollback: whatever step failed (rollout, smoke
                            // test, the switch itself), point the live Service back at
                            // the colour that was serving before this build. Patching an
                            // unchanged selector is a no-op, so this is always safe.
                            withCredentials([file(credentialsId: 'kubeconfig-kind', variable: 'KUBECONFIG')]) {
                                script {
                                    if (env.BG_PREVIOUS) {
                                        echo "ROLLBACK: deploy to ${env.BG_NEXT} failed - routing traffic back to ${env.BG_PREVIOUS}"
                                        sh """kubectl patch svc taskflow -p '{"spec":{"selector":{"color":"${env.BG_PREVIOUS}"}}}'"""
                                        // Also return the idle colour to its last good
                                        // image, so the next deploy starts from a healthy
                                        // standby instead of a crash-looping one.
                                        sh "kubectl rollout undo deployment/taskflow-${env.BG_NEXT} || true"
                                        sh 'kubectl get svc taskflow -o yaml'
                                        echo "ROLLBACK complete: live colour is ${env.BG_PREVIOUS}"
                                    } else {
                                        echo 'ROLLBACK: failed before the live colour was read - nothing to roll back'
                                    }
                                }
                            }
                        }
                    }
                }

                stage('Deploy — Staging') {
                    // Placeholder release step: no agent needed for a log line.
                    when {
                        branch 'develop'
                    }
                    steps {
                        script { env.CURRENT_STAGE = env.STAGE_NAME }
                        echo 'deploying to staging...'
                    }
                }

                stage('Pipeline Health Gate') {
                    // Lab 10: before anyone is asked to release, check that the
                    // pipeline itself is healthy. Queries the Lab 09 Prometheus server
                    // for the success rate of this job's builds (all branches and
                    // PRs); below 90% the production deploy is blocked.
                    //
                    // "Last 20 builds": the Prometheus metrics plugin exposes build
                    // counters, not a list of builds, so the gate widens a time
                    // window (1h, 3h, ... 30d) until it holds at least 20 finished
                    // builds and uses the success ratio inside it. increase() copes
                    // with the counters resetting when Jenkins restarts.
                    // Fails closed: no Prometheus, or no build data, means no deploy.
                    when {
                        beforeAgent true
                        branch 'main'
                    }
                    agent {
                        kubernetes {
                            cloud 'kind'
                            yamlFile 'ci/k8s/kubectl.yaml'
                            defaultContainer 'kubectl'
                        }
                    }
                    options {
                        timeout(time: 5, unit: 'MINUTES')
                    }
                    environment {
                        PROMETHEUS_URL = 'http://prometheus:9090'
                        HEALTH_JOBS = 'taskflow-multibranch/.*'
                        HEALTH_MIN_BUILDS = '20'
                        HEALTH_MIN_RATE = '0.90'
                    }
                    steps {
                        script {
                            env.CURRENT_STAGE = env.STAGE_NAME
                            def rc = sh(returnStatus: true, script: '''
                                query() {
                                    curl -sf --max-time 10 --get "$PROMETHEUS_URL/api/v1/query" \
                                      --data-urlencode "query=$1" | jq -r '.data.result[0].value[1] // "0"'
                                }
                                if ! curl -sf --max-time 10 "$PROMETHEUS_URL/-/ready" > /dev/null; then
                                    echo "Prometheus is not reachable at $PROMETHEUS_URL - failing closed"
                                    exit 2
                                fi
                                for window in 1h 3h 6h 12h 1d 3d 7d 30d; do
                                    total=$(query "round(sum(increase(default_jenkins_builds_total_build_count_total{jenkins_job=~'$HEALTH_JOBS'}[$window])))")
                                    total=${total%.*}
                                    [ "$total" -ge "$HEALTH_MIN_BUILDS" ] && break
                                done
                                success=$(query "round(sum(increase(default_jenkins_builds_success_build_count_total{jenkins_job=~'$HEALTH_JOBS'}[$window])))")
                                success=${success%.*}
                                if [ "$total" -eq 0 ]; then
                                    echo "No finished builds of $HEALTH_JOBS recorded in Prometheus - failing closed"
                                    exit 2
                                fi
                                awk -v s="$success" -v t="$total" -v w="$window" -v min="$HEALTH_MIN_RATE" -v n="$HEALTH_MIN_BUILDS" 'BEGIN {
                                    printf "Pipeline health: %d of %d builds succeeded (%.1f%%) in the last %s (window widened up to 30d until it holds >= %d builds); required >= %.0f%%\\n", s, t, s * 100 / t, w, n, min * 100
                                    exit (s / t < min) ? 1 : 0
                                }'
                            ''')
                            if (rc != 0) {
                                error('Pipeline Health Gate: production deploy blocked (see the health figures above)')
                            }
                            echo 'Pipeline Health Gate: passed - the pipeline is healthy enough to release'
                        }
                    }
                }

                stage('Deploy — Production') {
                    when {
                        // Without beforeInput, Jenkins asks "Deploy to production?" before
                        // checking the branch, so feature and develop builds would stop at
                        // the prompt too.
                        beforeInput true
                        branch 'main'
                    }
                    options {
                        // Give a human up to an hour to approve; after that the build is
                        // aborted instead of waiting forever.
                        timeout(time: 1, unit: 'HOURS')
                    }
                    input {
                        message 'Deploy to production?'
                        ok 'Deploy'
                        // Only the admin role may release to production (Lab 02 RBAC).
                        submitter 'admin'
                    }
                    // Placeholder release step: no agent needed for a log line.
                    steps {
                        script { env.CURRENT_STAGE = env.STAGE_NAME }
                        echo 'deploying to production...'
                    }
                }
            }
        }
    }

    post {
        success {
            echo "✅ ${env.APP_NAME} pipeline passed on branch ${env.BRANCH_NAME ?: 'main'} (NODE_ENV=${env.NODE_ENV})"
            script { notifyBuild('SUCCESS') }
        }
        failure {
            echo "❌ ${env.APP_NAME} failed at stage: ${env.CURRENT_STAGE}"
            script { notifyBuild('FAILURE') }
        }
    }
}

// Lab 10: e-mail the result with the branch and a link to the build. Sent by
// the Mailer plugin through the SMTP server set under Manage Jenkins -> System
// -> E-mail Notification (in the lab: Mailpit, http://127.0.0.1:8025). A mail
// problem is logged but never changes the build result.
def notifyBuild(String result) {
    def branch = env.BRANCH_NAME ?: 'main'
    def body = [
        "Job:       ${env.JOB_NAME}",
        "Branch:    ${branch}",
        "Build:     #${env.BUILD_NUMBER}",
        "Result:    ${result}",
    ]
    if (result == 'FAILURE') {
        body << "Failed at: ${env.CURRENT_STAGE}"
    }
    body << "Duration:  ${currentBuild.durationString.replace(' and counting', '')}"
    body << "Build URL: ${env.BUILD_URL}"
    try {
        mail(
            to: env.NOTIFY_EMAIL,
            subject: "${result == 'SUCCESS' ? '✅' : '❌'} ${env.APP_NAME} [${branch}] #${env.BUILD_NUMBER}: ${result}",
            body: body.join('\n')
        )
    } catch (err) {
        echo "Notification e-mail not sent: ${err.message}"
    }
}
