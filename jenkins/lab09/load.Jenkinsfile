// Lab 09 Task 6 — job `taskflow-k8s-load` (Pipeline script, parameterized with
// a String parameter RUN). One "build" = one pod from the `node` template
// (label k8s-node) that holds its slot for 4 minutes, so a few concurrent runs
// are enough to exhaust a small pod concurrency limit.
pipeline {
    agent { label 'k8s-node' }
    options {
        timeout(time: 30, unit: 'MINUTES')
    }
    stages {
        stage('Simulated build') {
            steps {
                container('node') {
                    sh 'echo "load run $RUN on pod $(hostname)"; sleep 240'
                }
            }
        }
    }
}
