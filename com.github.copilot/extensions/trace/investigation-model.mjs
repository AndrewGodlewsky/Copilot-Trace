export class InvestigationError extends Error {}
export const problem = message => new InvestigationError(message);
export const validId = value => typeof value === 'string' && value.length > 0 && value.length <= 128 && /^[a-z0-9][a-z0-9._:+/-]*$/i.test(value) && !value.includes('://');
export const efforts = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];
export const sameAccount = (a, b) => a?.isAuthenticated === true && b?.isAuthenticated === true &&
  [a.login, a.host, b.login, b.host].every(value => typeof value === 'string' && value.length > 0 && value.length <= 256 && !/[\s\p{C}]/u.test(value)) &&
  a.login.toLowerCase() === b.login.toLowerCase() && a.host.toLowerCase() === b.host.toLowerCase();

export function modelCatalog(catalog, account) {
  if (!sameAccount(account, account)) throw problem('Sign in to Copilot before investigating.');
  if (!Array.isArray(catalog?.list) || catalog.list.length > 500) throw problem('Copilot model catalog is unavailable.');
  const seen = new Set(), models = [];
  for (const item of catalog.list) {
    const providerId = item?.provider?.id;
    if (!validId(item?.id) || !validId(providerId)) throw problem('Copilot model identity is unavailable.');
    const key = `${providerId}/${item.id}`;
    if (seen.has(key)) throw problem('Copilot model catalog contains ambiguous identities.');
    seen.add(key);
    if (item.provider.kind !== 'copilot' || item.id === 'auto' || (item.policy && item.policy.state !== 'enabled')) continue;
    const supported = item.supportedReasoningEfforts;
    if (item.capabilities?.supports?.reasoningEffort !== true || !Array.isArray(supported) || !supported.length || supported.some(value => !efforts.includes(value))) continue;
    models.push({ id: item.id, providerId, name: typeof item.name === 'string' && item.name.length <= 200 && !/\p{C}/u.test(item.name) ? item.name : item.id,
      efforts: efforts.filter(value => supported.includes(value)) });
  }
  return { models, account: { isAuthenticated: true, login: account.login, host: account.host } };
}

export function selectModel(catalog, settings) {
  const candidates = catalog.models.filter(item => settings.modelId ? item.id === settings.modelId && item.providerId === settings.providerId : item.id === 'claude-haiku-5.5');
  if (candidates.length !== 1) throw problem(settings.modelId ? 'The saved model is unavailable. Choose an eligible model in Settings; no fallback was selected.' : 'Haiku 5.5 is unavailable or ambiguous for this account. Choose an eligible model in Settings; no fallback was selected.');
  const model = candidates[0], effort = settings.effort ?? model.efforts.at(-1);
  if (!model.efforts.includes(effort)) throw problem('The saved reasoning effort is unavailable. Update Settings.');
  return { ...model, effort };
}
