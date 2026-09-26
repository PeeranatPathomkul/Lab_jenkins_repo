pipeline {
    // Run every step inside a throwaway node:20-alpine container, started on the
    // linux-build agent (the only node with a Docker CLI + host socket).
    agent {
        docker {
            image 'node:20-alpine'
            label 'linux-build'
            // The container runs as the agent's UID, which has no writable home
            // directory inside node:20-alpine, so point npm's cache at /tmp.
            args '-e npm_config_cache=/tmp/.npm'
        }
    }

    environment {
        APP_NAME = 'poonsuk-api'
        NODE_ENV = 'test'
    }

    options {
        // A pipeline stage must never run unbounded: a hung `npm ci` (registry or
        // network stall) or a test that never exits (open DB/Redis handle, Jest
        // left in watch mode) would hold the executor forever. linux-build has a
        // single executor, so every later build would silently queue behind the
        // stuck one. Aborting after 10 minutes frees the agent, removes the
        // leftover node:20-alpine container, and turns an invisible hang into a
        // visible failed build. A normal run takes about 1-2 minutes, so 10
        // minutes leaves plenty of headroom without hiding real problems.
        timeout(time: 10, unit: 'MINUTES')
    }

    stages {
        stage('Install') {
            steps {
                // Inside the pipeline-level post block env.STAGE_NAME is always
                // "Declarative: Post Actions", so each stage records its own name
                // here for the failure message.
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
                    sh 'npm test'
                }
            }
        }
    }

    post {
        success {
            echo "✅ ${env.APP_NAME} passed Install, Lint and Unit Test (NODE_ENV=${env.NODE_ENV})"
        }
        failure {
            echo "❌ ${env.APP_NAME} failed at stage: ${env.CURRENT_STAGE}"
        }
        always {
            archiveArtifacts artifacts: '**/npm-debug.log*', allowEmptyArchive: true
        }
    }
}
