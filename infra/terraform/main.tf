# ---------------------------------------------------------------------------
# AWS side (LocalStack): the environment poonsuk-api deploys into.
# ---------------------------------------------------------------------------

resource "aws_security_group" "app" {
  name = "poonsuk-api-sg"

  ingress {
    from_port   = var.app_port
    to_port     = var.app_port
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_instance" "app" {
  ami                    = var.ami_id
  instance_type          = var.instance_type
  vpc_security_group_ids = [aws_security_group.app.id]

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

resource "docker_container" "host" {
  name     = "poonsuk-host"
  image    = docker_image.host.image_id
  hostname = "poonsuk-host"
  restart  = "unless-stopped"

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
