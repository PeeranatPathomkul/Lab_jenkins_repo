variable "aws_region" {
  description = "Region used for the LocalStack resources and state bucket."
  type        = string
  default     = "us-east-1"
}

variable "localstack_endpoint" {
  description = "LocalStack edge endpoint, reachable on the `jenkins` Docker network."
  type        = string
  default     = "http://localstack:4566"
}

variable "ami_id" {
  description = "AMI for the (mock) EC2 instance; any ID LocalStack accepts."
  type        = string
  default     = "ami-df5de72bdb3b"
}

variable "instance_type" {
  description = "EC2 instance type."
  type        = string
  default     = "t3.micro"
}

variable "app_port" {
  description = "Port the API is served on; the only port the security group opens."
  type        = number
  default     = 8080
}

variable "ssh_public_key" {
  description = "Public half of the Ansible SSH key (the private half stays in Jenkins credentials)."
  type        = string
}

variable "host_network" {
  description = "Docker network the host container joins, so Jenkins/Ansible can reach it."
  type        = string
  default     = "jenkins"
}
