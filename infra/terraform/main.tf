# ---------------------------------------------------------------------------
# AWS side (LocalStack): the environment poonsuk-api deploys into.
# ---------------------------------------------------------------------------

resource "aws_security_group" "app" {
  name        = "poonsuk-api-sg"
  description = "poonsuk-api host: app port from the private network, HTTPS out"

  # Lab 08 fix (tfsec aws-ec2-no-public-ingress-sgr, CRITICAL): the app port
  # is reachable only from the private network, not 0.0.0.0/0.
  ingress {
    description = "poonsuk-api HTTP from the private network"
    from_port   = var.app_port
    to_port     = var.app_port
    protocol    = "tcp"
    cidr_blocks = [var.allowed_cidr]
  }

  # Lab 08 fix (checkov CKV_AWS_382): egress narrowed from all ports/protocols
  # to HTTPS only. Accepted risk (tfsec aws-ec2-no-public-egress-sgr): the host
  # must reach package mirrors over the internet and the lab has no NAT/egress
  # proxy, so HTTPS to 0.0.0.0/0 stays open.
  #tfsec:ignore:aws-ec2-no-public-egress-sgr
  egress {
    description = "HTTPS to package mirrors and registries"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

# Lab 08 fix (checkov CKV2_AWS_41): the instance gets an IAM role (no policies
# attached, i.e. least privilege) instead of relying on access keys.
resource "aws_iam_role" "app" {
  name = "poonsuk-api-host"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "ec2.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_instance_profile" "app" {
  name = "poonsuk-api-host"
  role = aws_iam_role.app.name
}

resource "aws_instance" "app" {
  # Accepted for the lab (checkov CKV_AWS_126, detailed monitoring): LocalStack
  # 4.4 does not implement MonitorInstances (returns 501), so `monitoring = true`
  # cannot be applied here. On real AWS, set monitoring = true and drop this skip.
  #checkov:skip=CKV_AWS_126:LocalStack 4.4 does not implement EC2 detailed monitoring
  ami                    = var.ami_id
  instance_type          = var.instance_type
  vpc_security_group_ids = [aws_security_group.app.id]
  iam_instance_profile   = aws_iam_instance_profile.app.name

  # Lab 08 fix (checkov CKV_AWS_135).
  ebs_optimized = true

  # Lab 08 fix (tfsec aws-ec2-enforce-http-token-imds, checkov CKV_AWS_79):
  # IMDSv2 only, so SSRF cannot read instance credentials via IMDSv1.
  metadata_options {
    http_endpoint = "enabled"
    http_tokens   = "required"
  }

  # Lab 08 fix (tfsec aws-ec2-enable-at-rest-encryption, checkov CKV_AWS_8).
  root_block_device {
    encrypted   = true
    volume_type = "gp3"
    volume_size = 8
  }

  tags = {
    Name = "poonsuk-api-host"
  }
}

# ---------------------------------------------------------------------------
# Real host (Docker): LocalStack community EC2 does not start a machine, so
# this container is the instance's stand-in — an Ubuntu box with SSH that
# Ansible configures. It is tied to the instance by name and labels.
# ---------------------------------------------------------------------------

resource "docker_image" "host" {
  name = "poonsuk-host:lab08"

  build {
    context = "${path.module}/../host"
  }

  triggers = {
    dockerfile = filesha1("${path.module}/../host/Dockerfile")
  }
}

# Docker's data dir on the host. overlay2 cannot sit on the container's own
# overlay filesystem, so it needs a volume; destroy removes it with the host.
resource "docker_volume" "host_docker" {
  name = "poonsuk-host-docker"
}

resource "docker_container" "host" {
  name     = "poonsuk-host"
  image    = docker_image.host.image_id
  hostname = "poonsuk-host"
  restart  = "unless-stopped"

  # Ansible installs and starts a Docker daemon inside this "VM"; running
  # dockerd in a container needs privileged mode (lab stand-in only).
  privileged = true

  volumes {
    volume_name    = docker_volume.host_docker.name
    container_path = "/var/lib/docker"
  }

  networks_advanced {
    name = var.host_network
  }

  # Only the Ansible user's public key; the private key never enters Terraform.
  upload {
    content = var.ssh_public_key
    file    = "/home/ansible/.ssh/authorized_keys"
  }

  labels {
    label = "ec2-instance-id"
    value = aws_instance.app.id
  }
  labels {
    label = "security-group-id"
    value = aws_security_group.app.id
  }
}
