#!/bin/sh
# LocalStack "ready" hook (mounted into /etc/localstack/init/ready.d/).
# LocalStack community keeps no data across restarts, so re-create the
# Terraform remote-state bucket every time it starts (Lab 08 backend.tf).
awslocal s3 mb s3://poonsuk-tfstate 2>/dev/null || true
awslocal s3 ls
