output "instance_id" {
  description = "EC2 instance ID (LocalStack)."
  value       = aws_instance.app.id
}

output "security_group_id" {
  description = "Security group allowing the app port."
  value       = aws_security_group.app.id
}

output "instance_public_ip" {
  description = "Public IP LocalStack assigned to the (mock) instance."
  value       = aws_instance.app.public_ip
}

output "instance_address" {
  description = "Address of the real host Ansible configures (container on var.host_network)."
  value       = docker_container.host.network_data[0].ip_address
}

output "instance_hostname" {
  description = "DNS name of the real host on var.host_network."
  value       = docker_container.host.hostname
}
