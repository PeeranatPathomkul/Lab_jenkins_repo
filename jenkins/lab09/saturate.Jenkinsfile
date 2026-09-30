// Lab 09 Task 6 — job `taskflow-k8s-saturate` (Pipeline script).
// Queues 10 concurrent runs of taskflow-k8s-load. Each run gets a different
// RUN value: Jenkins folds identical queued builds of one job into a single
// item, so clicking "Build Now" 10 times would not produce 10 builds.
// No agent: the `build` step only talks to the queue.
pipeline {
    agent none
    stages {
        stage('Trigger 10 concurrent builds') {
            steps {
                script {
                    for (int i = 1; i <= 10; i++) {
                        build job: 'taskflow-k8s-load', wait: false,
                              parameters: [string(name: 'RUN', value: "${i}")]
                    }
                }
            }
        }
    }
}
