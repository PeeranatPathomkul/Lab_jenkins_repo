pipeline {
    // No pipeline-wide agent: the CI stages get a throwaway node:20-alpine
    // container, and the deploy stages grab an executor only after their `when`
    // (and, for production, the human approval) has passed. That way a build
    // waiting on "Deploy to production?" does not hold linux-build's single
    // executor, and other branches can keep building.
    agent none

    environment {
        APP_NAME = 'poonsuk-api'
        NODE_ENV = 'test'
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
                docker {
                    image 'zricethezav/gitleaks:v8.30.1'
                    label 'linux-build'
                    args '--entrypoint='
                }
            }
            options {
                timeout(time: 5, unit: 'MINUTES')
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

        stage('Verify') {
            // Lab 10: every check that needs nothing but the commit runs side by
            // side - lint + unit tests, SAST, SCA, SBOM and the IaC checks. They
            // share no files, so none has to wait for another. failFast: the
            // first branch to fail aborts the others, so a bad commit is reported
            // as soon as the quickest failing check finishes.
            // (A critical CVE in SCA is caught with catchError, so it does not
            // abort the rest; the Policy Gate right after stops the build.)
            // Branches record CURRENT_STAGE in post.failure instead of at the
            // start: set at the start, it would just name the branch that began
            // last, not the one that failed.
            failFast true
            parallel {
                stage('Lint & Unit Test') {
                    // Lab 09: every CI step runs in a fresh Kubernetes pod in the kind
                    // cluster (cloud `kind`, namespace jenkins-agents), created for this
                    // run and deleted afterwards — instead of a container on the static
                    // linux-build agent (Lab 03). The plugin adds the `jnlp` container
                    // that connects back to Jenkins; steps run in `node`.
                    agent {
                        kubernetes {
                            cloud 'kind'
                            defaultContainer 'node'
                            yaml '''
                                apiVersion: v1
                                kind: Pod
                                spec:
                                  containers:
                                  - name: node
                                    image: node:20-alpine
                                    command: ['cat']
                                    tty: true
                            '''
                        }
                    }
                    options {
                        // A pipeline stage must never run unbounded: a hung `npm ci`
                        // (registry or network stall) or a test that never exits (open
                        // DB/Redis handle, Jest left in watch mode) would hold the executor
                        // forever. linux-build has a single executor, so every later build
                        // would silently queue behind the stuck one. Aborting after 10
                        // minutes frees the agent, removes the leftover node:20-alpine
                        // container, and turns an invisible hang into a visible failed
                        // build. A normal run takes about 1-2 minutes, so 10 minutes leaves
                        // plenty of headroom without hiding real problems.
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
                                    // The pod (and its workspace) is deleted after CI;
                                    // SonarQube Analysis runs on linux-build and needs the
                                    // coverage report, so hand it over explicitly.
                                    stash name: 'coverage', includes: 'backend/coverage/lcov.info', allowEmpty: true
                                }
                            }
                        }
                    }
                    post {
                        always {
                            // Needs a workspace, so it lives here rather than in the
                            // pipeline-level post (which has no agent with `agent none`).
                            archiveArtifacts artifacts: '**/npm-debug.log*', allowEmptyArchive: true
                        }
                    }
                }

                stage('SAST — ESLint') {
                    // Static analysis of our own code for insecure patterns, after
                    // secrets and alongside SCA, before any build.
                    agent {
                        docker {
                            image 'node:20-alpine'
                            label 'linux-build'
                            args '-e npm_config_cache=/tmp/.npm'
                        }
                    }
                    options {
                        timeout(time: 10, unit: 'MINUTES')
                    }
                    steps {
                        dir('backend') {
                            sh 'npm ci'
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
                        failure {
                            script { env.CURRENT_STAGE = env.STAGE_NAME }
                        }
                    }
                }

                stage('SAST — Semgrep') {
                    agent {
                        docker {
                            image 'semgrep/semgrep:1.177.0'
                            label 'linux-build'
                            // Semgrep keeps settings under $HOME, which the agent UID
                            // cannot write in this image.
                            args '-e HOME=/tmp'
                        }
                    }
                    options {
                        timeout(time: 10, unit: 'MINUTES')
                    }
                    steps {
                        // OWASP Top 10 + Node.js rule packs from the Semgrep Registry.
                        // One run prints the summary to the log and writes SARIF.
                        // Semgrep exits 0 even with findings (no --error), so like ESLint
                        // this stage reports; blocking lives in SCA and the Policy Gate.
                        sh 'semgrep scan --config=p/owasp-top-ten --config=p/nodejs --metrics=off --sarif-output=semgrep.sarif backend/src'
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
                    // read straight from package-lock.json (no install needed).
                    agent {
                        docker {
                            image 'node:20-alpine'
                            label 'linux-build'
                            args '-e npm_config_cache=/tmp/.npm'
                        }
                    }
                    options {
                        timeout(time: 5, unit: 'MINUTES')
                    }
                    steps {
                        dir('backend') {
                            // npm audit exits non-zero whenever anything >= high exists;
                            // `|| true` hands the verdict to the threshold logic below
                            // instead of that exit code.
                            sh 'npm audit --audit-level=high --json > audit.json || true'
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
                            // The Policy Gate reads it later, maybe in another workspace.
                            stash name: 'audit', includes: 'backend/audit.json', allowEmpty: true
                        }
                        failure {
                            script { env.CURRENT_STAGE = env.STAGE_NAME }
                        }
                    }
                }

                stage('Generate SBOM') {
                    // Syft and Cosign ship as distroless images (no shell), so they
                    // cannot be a `docker { }` agent. Instead this runs on linux-build
                    // and starts them with `docker run --volumes-from` this agent
                    // container, which shares the workspace volume with them.
                    agent { label 'linux-build' }
                    options {
                        timeout(time: 10, unit: 'MINUTES')
                    }
                    environment {
                        SYFT_IMAGE = 'anchore/syft:v1.52.0'
                        COSIGN_IMAGE = 'ghcr.io/sigstore/cosign/cosign:v3.1.3'
                        SBOM = 'sbom/poonsuk-api.cdx.json'
                    }
                    steps {
                        sh 'mkdir -p sbom'
                        // CycloneDX SBOM of backend/ (package-lock.json -> every npm
                        // package and version), tagged with the commit it describes.
                        sh '''
                            docker run --rm --volumes-from "$(hostname)" -w "$WORKSPACE" \
                              -u "$(id -u):$(id -g)" -e XDG_CACHE_HOME=/tmp \
                              "$SYFT_IMAGE" scan dir:backend \
                              --source-name poonsuk-api --source-version "$GIT_COMMIT" \
                              -o cyclonedx-json="$SBOM"
                        '''
                        // Sign with the lab's local Cosign key pair. The private key and
                        // its password come only from Jenkins credentials. No
                        // transparency-log upload: the lab key is not a public identity.
                        withCredentials([
                            file(credentialsId: 'cosign-key', variable: 'COSIGN_KEY'),
                            string(credentialsId: 'cosign-password', variable: 'COSIGN_PASSWORD'),
                        ]) {
                            sh '''
                                docker run --rm --volumes-from "$(hostname)" -w "$WORKSPACE" \
                                  -u "$(id -u):$(id -g)" -e COSIGN_PASSWORD \
                                  "$COSIGN_IMAGE" sign-blob --yes --key "$COSIGN_KEY" \
                                  --use-signing-config=false --new-bundle-format=false --tlog-upload=false \
                                  --output-signature "$SBOM.sig" "$SBOM"
                            '''
                        }
                        // Prove the signature matches the committed public key.
                        sh '''
                            docker run --rm --volumes-from "$(hostname)" -w "$WORKSPACE" \
                              -u "$(id -u):$(id -g)" \
                              "$COSIGN_IMAGE" verify-blob --key cosign.pub \
                              --signature "$SBOM.sig" --insecure-ignore-tlog=true "$SBOM"
                        '''
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
                    agent {
                        docker {
                            image 'hashicorp/terraform:1.16.4'
                            label 'linux-build'
                            // tf_plugin_cache: providers downloaded once, reused by
                            // every later terraform stage (volume owned by UID 1000).
                            // TF_DATA_DIR: a private, throwaway .terraform dir, so
                            // this backend-less validate never picks up the S3
                            // backend that Terraform Plan initialised in the shared
                            // workspace (which would demand AWS credentials).
                            args '--entrypoint= -e HOME=/tmp -e TF_IN_AUTOMATION=1 -e TF_DATA_DIR=/tmp/tf-validate-data -e TF_PLUGIN_CACHE_DIR=/tmp/tf-plugin-cache -v tf_plugin_cache:/tmp/tf-plugin-cache'
                        }
                    }
                    options {
                        timeout(time: 10, unit: 'MINUTES')
                    }
                    steps {
                        dir('infra/terraform') {
                            // -backend=false: validation needs the providers,
                            // not the remote state.
                            sh 'terraform init -backend=false -input=false'
                            sh 'terraform validate'
                            sh 'terraform fmt -check -recursive'
                        }
                    }
                    post {
                        failure {
                            script { env.CURRENT_STAGE = env.STAGE_NAME }
                        }
                    }
                }

                stage('Ansible Lint') {
                    agent {
                        docker {
                            // ansible-lint 26.1.1 (the image publishes no version
                            // tags, so it is pinned by digest).
                            image 'pipelinecomponents/ansible-lint@sha256:a767239e6442051d483a85a6ae1c83973c94c7b684f31d2812d8f616081a87af'
                            label 'linux-build'
                            args '--entrypoint= -e HOME=/tmp'
                        }
                    }
                    options {
                        timeout(time: 10, unit: 'MINUTES')
                    }
                    steps {
                        sh 'ansible-lint infra/ansible/playbook.yml'
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
                    agent { label 'linux-build' }
                    options {
                        timeout(time: 10, unit: 'MINUTES')
                    }
                    environment {
                        TFSEC_IMAGE   = 'aquasec/tfsec:v1.28.14'
                        CHECKOV_IMAGE = 'bridgecrew/checkov:3.3.20'
                    }
                    steps {
                        script {
                            sh 'mkdir -p reports/iac'
                            // tfsec: SARIF report (never fails), then the gate run whose
                            // table goes to the log and whose exit code counts.
                            sh '''
                                docker run --rm --volumes-from "$(hostname)" -w "$WORKSPACE" -u "$(id -u):$(id -g)" \
                                  "$TFSEC_IMAGE" infra/terraform --no-color --soft-fail \
                                  --format sarif --out reports/iac/tfsec.sarif
                            '''
                            def tfsec = sh(returnStatus: true, script: '''
                                docker run --rm --volumes-from "$(hostname)" -w "$WORKSPACE" -u "$(id -u):$(id -g)" \
                                  "$TFSEC_IMAGE" infra/terraform --no-color
                            ''')
                            // checkov: one run prints to the log and writes SARIF.
                            def checkov = sh(returnStatus: true, script: '''
                                docker run --rm --volumes-from "$(hostname)" -w "$WORKSPACE" -u "$(id -u):$(id -g)" \
                                  -e HOME=/tmp "$CHECKOV_IMAGE" -d infra/terraform --framework terraform --compact \
                                  -o cli -o sarif --output-file-path console,reports/iac/checkov.sarif
                            ''')
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

        stage('Policy Gate') {
            // The last security gate before any build: OPA decides, from the SCA
            // report, whether this commit may continue. Unlike the SCA stage,
            // a deny here stops the pipeline outright.
            agent { label 'linux-build' }
            options {
                timeout(time: 5, unit: 'MINUTES')
            }
            environment {
                // Distroless image, so it is run via docker, like Syft/Cosign.
                OPA_IMAGE = 'openpolicyagent/opa:1.21.0'
            }
            steps {
                script { env.CURRENT_STAGE = env.STAGE_NAME }
                // audit.json comes from the SCA branch of Verify, which ran in
                // parallel and so possibly in a different workspace.
                unstash 'audit'
                // Unit tests for the policy itself (policy/security_test.rego).
                sh '''
                    docker run --rm --volumes-from "$(hostname)" -w "$WORKSPACE" \
                      -u "$(id -u):$(id -g)" "$OPA_IMAGE" test policy/ -v
                '''
                script {
                    // --fail-defined: exit non-zero if any deny message exists.
                    // A missing/unreadable audit.json also exits non-zero, so the
                    // gate fails closed.
                    def status = sh(returnStatus: true, script: '''
                        docker run --rm --volumes-from "$(hostname)" -w "$WORKSPACE" \
                          -u "$(id -u):$(id -g)" "$OPA_IMAGE" eval --fail-defined --format pretty \
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

        stage('Integration & Quality') {
            // E2E exercises the running API; SonarQube needs only the source and
            // the coverage from Unit Test. Neither uses the other's output, so
            // they run in parallel. Analysis -> Quality Gate stays sequential
            // inside its branch (the gate waits for that analysis).
            failFast true
            parallel {
                stage('E2E') {
                    // Needs the Docker CLI + compose plugin, so it runs directly on
                    // linux-build; the Playwright tests themselves run inside the
                    // mcr.microsoft.com/playwright container below.
                    agent { label 'linux-build' }
                    options {
                        // Building the API image + migrations + tests takes a few
                        // minutes; still never unbounded.
                        timeout(time: 15, unit: 'MINUTES')
                    }
                    environment {
                        // One compose project per linux-build executor: with several
                        // executors (Lab 10), two builds' E2E can run at once (e.g. a
                        // branch build and its PR build from the same push). No host
                        // ports are published (docker-compose.ci.yml), so the project
                        // name is the only thing that has to differ. The network the
                        // Playwright container joins is poonsuk-e2e-<executor>_default.
                        COMPOSE = 'docker compose -p poonsuk-e2e-$EXECUTOR_NUMBER -f docker-compose.yml -f docker-compose.ci.yml'
                    }
                    steps {
                        dir('backend') {
                            // Fresh database every run: schema via migrations, demo
                            // users/rooms via the seed scripts, then start the API and
                            // wait for /health/ready.
                            sh '$COMPOSE down -v --remove-orphans || true'
                            sh '$COMPOSE build api'
                            sh '$COMPOSE up -d --wait postgres redis'
                            // The production image ships without npm/npx (Lab 07), so
                            // call the TypeORM CLI with node directly.
                            sh '$COMPOSE run --rm --no-deps api node node_modules/typeorm/cli.js migration:run -d dist/config/data-source.js'
                            sh '$COMPOSE run --rm --no-deps api node dist/database/seed-users.js'
                            sh '$COMPOSE run --rm --no-deps api node dist/database/seed-rooms.js'
                            sh '$COMPOSE up -d --wait api'
                        }
                        script {
                            docker.image('mcr.microsoft.com/playwright:v1.63.0-noble')
                                .inside("--network poonsuk-e2e-${env.EXECUTOR_NUMBER}_default -e HOME=/tmp -e npm_config_cache=/tmp/.npm -e CI=true -e E2E_BASE_URL=http://api:3000") {
                                    dir('e2e') {
                                        sh 'npm ci'
                                        sh 'npx playwright test'
                                    }
                                }
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
                            dir('backend') {
                                sh '$COMPOSE logs --no-color --tail=100 api || true'
                            }
                        }
                        failure {
                            script { env.CURRENT_STAGE = env.STAGE_NAME }
                        }
                        cleanup {
                            dir('backend') {
                                sh '$COMPOSE down -v --remove-orphans || true'
                            }
                        }
                    }
                }

                stage('SonarQube') {
                    stages {
                        stage('SonarQube Analysis') {
                            // Scanner runs in its own throwaway container on linux-build;
                            // the coverage report arrives by stash from Unit Test.
                            // --network jenkins lets it reach http://sonarqube:9000.
                            agent {
                                docker {
                                    image 'sonarsource/sonar-scanner-cli:latest'
                                    label 'linux-build'
                                    args '--network jenkins --entrypoint= -e SONAR_USER_HOME=/tmp/.sonar'
                                }
                            }
                            options {
                                // Same reasoning as the CI stage: never let a stuck upload hold
                                // the executor.
                                timeout(time: 10, unit: 'MINUTES')
                            }
                            steps {
                                // Coverage now comes from the CI pod (Lab 09), not a shared
                                // linux-build workspace.
                                unstash 'coverage'
                                // Injects SONAR_HOST_URL and the sonar-token credential configured
                                // under Manage Jenkins -> System -> SonarQube servers.
                                withSonarQubeEnv('SonarQube') {
                                    dir('backend') {
                                        // Project key, sources and coverage path live in
                                        // backend/sonar-project.properties.
                                        sh 'sonar-scanner'
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
                            // No agent: waitForQualityGate only waits for SonarQube's webhook, so
                            // it should not hold linux-build's executor while it waits.
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

        stage('Build Image') {
            // Package the API that passed every gate above into an immutable,
            // commit-tagged image in the local registry. Never `latest`: a tag
            // must always mean the same bits, so a deploy or rollback is exact.
            agent { label 'linux-build' }
            options {
                timeout(time: 15, unit: 'MINUTES')
            }
            steps {
                script {
                    env.CURRENT_STAGE = env.STAGE_NAME
                    // The host's Docker daemon pushes to the registry container
                    // through its published port, so the image name uses
                    // localhost:5000. Later stages reuse IMAGE / IMAGE_TAG.
                    env.REGISTRY = 'localhost:5000'
                    env.IMAGE_TAG = env.GIT_COMMIT.take(7)
                    env.IMAGE = "${env.REGISTRY}/poonsuk-api:${env.IMAGE_TAG}"
                }
                sh '''
                    # Immutability: a commit's tag is pushed once and never
                    # overwritten; a re-run of the same commit reuses it.
                    if docker manifest inspect --insecure "$IMAGE" > /dev/null 2>&1; then
                        echo "$IMAGE already in the registry - not rebuilding or overwriting it"
                        exit 0
                    fi
                    docker build --target production \
                      --label org.opencontainers.image.revision="$GIT_COMMIT" \
                      --label org.opencontainers.image.source="$GIT_URL" \
                      -t "$IMAGE" backend
                    docker push "$IMAGE"
                '''
                // Show what the registry now holds for this repository.
                sh 'curl -s http://registry:5000/v2/poonsuk-api/tags/list; echo'
            }
        }

        stage('Container Scan') {
            // Scan the exact image that was just pushed (by its commit tag), OS
            // packages and node_modules alike, before anything deploys it.
            agent {
                docker {
                    image 'aquasec/trivy:0.74.0'
                    label 'linux-build'
                    // --network jenkins: pull from http://registry:5000.
                    // trivy_cache: keep the vulnerability DB between builds
                    // (volume owned by the agent UID 1000).
                    args '--entrypoint= --network jenkins -v trivy_cache:/tmp/trivy-cache -e TRIVY_CACHE_DIR=/tmp/trivy-cache -e TRIVY_INSECURE=true'
                }
            }
            options {
                timeout(time: 10, unit: 'MINUTES')
            }
            steps {
                script { env.CURRENT_STAGE = env.STAGE_NAME }
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
                docker {
                    image 'hashicorp/terraform:1.16.4'
                    label 'linux-build'
                    // --network jenkins: reach http://localstack:4566.
                    // docker.sock + group 0: the Docker provider builds/starts the
                    // host container on the host daemon.
                    args '--entrypoint= --network jenkins --group-add 0 -v /var/run/docker.sock:/var/run/docker.sock -e HOME=/tmp -e TF_IN_AUTOMATION=1 -e TF_PLUGIN_CACHE_DIR=/tmp/tf-plugin-cache -v tf_plugin_cache:/tmp/tf-plugin-cache'
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
            // the click does not hold linux-build's executor.
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
                docker {
                    image 'hashicorp/terraform:1.16.4'
                    label 'linux-build'
                    args '--entrypoint= --network jenkins --group-add 0 -v /var/run/docker.sock:/var/run/docker.sock -e HOME=/tmp -e TF_IN_AUTOMATION=1 -e TF_PLUGIN_CACHE_DIR=/tmp/tf-plugin-cache -v tf_plugin_cache:/tmp/tf-plugin-cache'
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
                docker {
                    image 'alpine/ansible:2.21.0'
                    label 'linux-build'
                    // -u 0:0: the SSH client refuses to run for a UID with no
                    // passwd entry (the agent's 1000 is unknown in this image).
                    // --network jenkins: reach the host container by address.
                    args '--entrypoint= -u 0:0 --network jenkins -e HOME=/tmp -e ANSIBLE_HOST_KEY_CHECKING=False -e ANSIBLE_FORCE_COLOR=0'
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
            agent { label 'linux-build' }
            options {
                timeout(time: 10, unit: 'MINUTES')
            }
            steps {
                script { env.CURRENT_STAGE = env.STAGE_NAME }
                // kubeconfig for the kind cluster (API server reached over the
                // `kind` Docker network) comes only from Jenkins credentials.
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
            when {
                // Skip the agent entirely on branches that do not deploy.
                beforeAgent true
                branch 'develop'
            }
            agent { label 'linux-build' }
            steps {
                script { env.CURRENT_STAGE = env.STAGE_NAME }
                sh 'echo deploying to staging...'
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
            agent { label 'linux-build' }
            steps {
                script { env.CURRENT_STAGE = env.STAGE_NAME }
                sh 'echo deploying to production...'
            }
        }
    }

    post {
        success {
            echo "✅ ${env.APP_NAME} pipeline passed on branch ${env.BRANCH_NAME ?: 'main'} (NODE_ENV=${env.NODE_ENV})"
        }
        failure {
            echo "❌ ${env.APP_NAME} failed at stage: ${env.CURRENT_STAGE}"
        }
    }
}
