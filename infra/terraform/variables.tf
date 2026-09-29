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
  # Must exist in LocalStack's built-in image catalogue: with root_block_device
  # set, the provider calls DescribeImages to find the root device name.
  description = "AMI for the (mock) EC2 instance (Ubuntu image from LocalStack's catalogue)."
  type        = string
  default     = "ami-785db401"
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

variable "allowed_cidr" {
  description = "Network allowed to reach the app port (the private network in front of the host, not the internet)."
  type        = string
  default     = "10.0.0.0/16"
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
