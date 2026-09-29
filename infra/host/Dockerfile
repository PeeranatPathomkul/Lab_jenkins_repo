# Lab 08 stand-in for the EC2 instance: a plain Ubuntu machine reachable over
# SSH, which Ansible then configures (Node.js, Docker, the API image).
# Built and started by Terraform (infra/terraform/main.tf).
FROM ubuntu:24.04

RUN apt-get update \
 && apt-get install -y --no-install-recommends openssh-server python3 sudo ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# Key-only login as `ansible` (passwordless sudo, as on a cloud image).
RUN useradd -m -s /bin/bash ansible \
 && echo 'ansible ALL=(ALL) NOPASSWD:ALL' > /etc/sudoers.d/ansible \
 && chmod 440 /etc/sudoers.d/ansible \
 && mkdir -p /run/sshd /home/ansible/.ssh \
 && chmod 700 /home/ansible/.ssh \
 && chown ansible:ansible /home/ansible/.ssh \
 && printf 'PasswordAuthentication no\nPermitRootLogin no\n' > /etc/ssh/sshd_config.d/lab08.conf

EXPOSE 22 8080
CMD ["/usr/sbin/sshd", "-D", "-e"]
