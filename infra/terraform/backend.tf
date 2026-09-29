# Remote state in LocalStack's S3 (Lab 08) — never a local terraform.tfstate.
# The bucket is created once, before the first `terraform init` (see the lab
# steps). Credentials come from AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY.
terraform {
  backend "s3" {
    bucket = "poonsuk-tfstate"
    key    = "lab08/terraform.tfstate"
    region = "us-east-1"

    endpoints = {
      s3 = "http://localstack:4566"
    }
    use_path_style              = true
    skip_credentials_validation = true
    skip_region_validation      = true
    skip_requesting_account_id  = true
    skip_metadata_api_check     = true

    # S3-native state locking (lock object next to the state).
    use_lockfile = true
  }
}
