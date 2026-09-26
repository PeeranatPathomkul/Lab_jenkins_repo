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
