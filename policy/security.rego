# Lab 06 Policy Gate: deny any build whose dependency scan reports a CRITICAL
# CVE. Evaluated by the Jenkinsfile's "Policy Gate" stage with `opa eval`.
#
# Input: the `npm audit --json` report the SCA stage writes to
# backend/audit.json.
package security

# Clause 1: the scan summary counts at least one critical vulnerability.
deny contains msg if {
	critical := input.metadata.vulnerabilities.critical
	critical > 0
	msg := sprintf("dependency scan reports %d CRITICAL vulnerabilities", [critical])
}

# Clause 2: an individual package is rated critical. Names the offending
# package, and still denies if a report's summary and its entries disagree.
deny contains msg if {
	some name, vuln in input.vulnerabilities
	vuln.severity == "critical"
	msg := sprintf("package %q has a CRITICAL advisory (affected versions: %s)", [name, vuln.range])
}
