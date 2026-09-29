# AWS provider pointed at LocalStack (community 4.4). Credentials come from
# the environment (AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY), never from code.
provider "aws" {
  region = var.aws_region

  skip_credentials_validation = true
  skip_metadata_api_check     = true
  skip_requesting_account_id  = true

  endpoints {
    ec2 = var.localstack_endpoint
    s3  = var.localstack_endpoint
    sts = var.localstack_endpoint
    iam = var.localstack_endpoint
  }

  default_tags {
    tags = {
      Project   = "poonsuk-api"
      ManagedBy = "terraform"
      Lab       = "08"
    }
  }
}

# LocalStack community EC2 is a mock (no real VM). The Docker provider creates
# the real machine Ansible configures: a container that stands in for the
# instance (see main.tf). Talks to the host Docker daemon via the socket.
provider "docker" {
  host = "unix:///var/run/docker.sock"
}
