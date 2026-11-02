// Redirect Rule (301, path and query kept) from some hosts to the main domain, added to the zone's dynamic-redirect ruleset.
// Existing rules are never overwritten: a rule with our description is only reported when it differs from what we would write.
export const REDIRECT_PHASE = 'http_request_dynamic_redirect';
export const REDIRECT_DESCRIPTION = 'BezReszty — przekierowanie aliasów na domenę główną';

export function redirectRule(hosts, domain) {
  return {
    action: 'redirect',
    description: REDIRECT_DESCRIPTION,
    enabled: true,
    expression: `http.host in {${hosts.map(host => `"${host}"`).join(' ')}}`,
    action_parameters: { from_value: { status_code: 301, preserve_query_string: true, target_url: { expression: `concat("https://${domain}", http.request.uri.path)` } } },
  };
}

// cf/json are the CLI wrappers of the calling script. Returns 'created' | 'added' | 'unchanged' | 'differs'; CLI failures throw.
export function ensureRedirectRule({ cf, json, zone, hosts, domain }) {
  const rule = redirectRule(hosts, domain);
  let entry = null;
  try { entry = json(['rulesets', 'account-rulesets', 'phases', 'get', REDIRECT_PHASE, '-z', zone]); } catch { /* no redirect rules in this zone yet */ }
  if (!entry) {
    cf(['rulesets', 'account-rulesets', 'create', '-z', zone, '--body', JSON.stringify({ name: 'default', kind: 'zone', phase: REDIRECT_PHASE, rules: [rule] })]);
    return 'created';
  }
  const existing = (entry.rules || []).find(item => item.description === REDIRECT_DESCRIPTION);
  if (!existing) {
    cf(['rulesets', 'account-rulesets', 'rules', 'create', entry.id, '-z', zone, '--body', JSON.stringify(rule)]);
    return 'added';
  }
  return existing.expression === rule.expression ? 'unchanged' : 'differs';
}
