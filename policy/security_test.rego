# Unit tests for security.rego, run with `opa test policy/` in the Policy Gate
# stage before the real evaluation.
package security_test

import data.security

clean_report := {
	"metadata": {"vulnerabilities": {"critical": 0, "high": 7}},
	"vulnerabilities": {"lodash": {"severity": "high", "range": "<=4.17.23"}},
}

critical_report := {
	"metadata": {"vulnerabilities": {"critical": 1, "high": 0}},
	"vulnerabilities": {"tar": {"severity": "critical", "range": "<=7.5.20"}},
}

test_allows_a_report_with_only_high_findings if {
	count(security.deny) == 0 with input as clean_report
}

test_summary_clause_denies_critical_count if {
	"dependency scan reports 1 CRITICAL vulnerabilities" in security.deny with input as critical_report
}

test_package_clause_names_the_critical_package if {
	some msg in security.deny with input as critical_report
	contains(msg, "\"tar\"")
}

test_package_clause_catches_a_critical_entry_missing_from_the_summary if {
	report := {
		"metadata": {"vulnerabilities": {"critical": 0}},
		"vulnerabilities": {"minimist": {"severity": "critical", "range": "<1.2.6"}},
	}
	count(security.deny) == 1 with input as report
}
