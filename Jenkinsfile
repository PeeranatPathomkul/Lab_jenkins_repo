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

    stages {
        stage('Secrets Detection') {
            // Shift-left: the first gate, before anything is installed or built.
            // A leaked credential is cheapest to fix here, before it spreads.
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

        stage('SAST — ESLint') {
            // Static analysis of our own code for insecure patterns, right after
            // secrets and before dependencies (SCA) or any build.
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
                script { env.CURRENT_STAGE = env.STAGE_NAME }
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
                script { env.CURRENT_STAGE = env.STAGE_NAME }
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
                script { env.CURRENT_STAGE = env.STAGE_NAME }
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
                            // lets the pipeline reach SBOM + Policy Gate, which is
                            // the stage that actually stops it before any build.
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
                script { env.CURRENT_STAGE = env.STAGE_NAME }
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

        stage('CI') {
            // Run every CI step inside a throwaway node:20-alpine container,
            // started on the linux-build agent (the only node with a Docker CLI
            // + host socket).
            agent {
                docker {
                    image 'node:20-alpine'
                    label 'linux-build'
                    // The container runs as the agent's UID, which has no writable
                    // home directory inside node:20-alpine, so point npm's cache
                    // at /tmp.
                    args '-e npm_config_cache=/tmp/.npm'
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
                // Fixed project name, so the compose network is always
                // poonsuk-e2e_default for the Playwright container to join.
                COMPOSE = 'docker compose -p poonsuk-e2e -f docker-compose.yml -f docker-compose.ci.yml'
            }
            steps {
                script { env.CURRENT_STAGE = env.STAGE_NAME }
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
                        .inside('--network poonsuk-e2e_default -e HOME=/tmp -e npm_config_cache=/tmp/.npm -e CI=true -e E2E_BASE_URL=http://api:3000') {
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
                cleanup {
                    dir('backend') {
                        sh '$COMPOSE down -v --remove-orphans || true'
                    }
                }
            }
        }

        stage('SonarQube Analysis') {
            // Scanner runs in its own throwaway container on linux-build. The
            // workspace (with backend/coverage/lcov.info from Unit Test) is the
            // same one the CI stage used. --network jenkins lets it reach
            // http://sonarqube:9000.
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
                script { env.CURRENT_STAGE = env.STAGE_NAME }
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
        }

        stage('Quality Gate') {
            // No agent: waitForQualityGate only waits for SonarQube's webhook, so
            // it should not hold linux-build's executor while it waits.
            steps {
                script { env.CURRENT_STAGE = env.STAGE_NAME }
                timeout(time: 5, unit: 'MINUTES') {
                    waitForQualityGate abortPipeline: true
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
