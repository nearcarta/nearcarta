// Prints the Guardhouse live checks. This file does not sign or broadcast.
export const GUARD_LIVE_STEPS = [
  'Check the example payee from the Check tab. That call is a view. No wallet opens and propose is not sent.',
  'Try poisoned invoice asks the charter for 0.001 NEAR. Stay at or under 0.06 NEAR. Warn does not send until you confirm. Block does not send until you say let it knock.',
  'A payee off the list is receiver_not_allowlisted. The recorded refusal is E7KMexjSGrD81BQuxVHWinyzvur63m6TGiw7bWjs1ubZ. A new receipt link is added only after that transaction is seen.',
  'Freeze my row and Unfreeze call set_frozen with deposit 0. The session key signs only when its method list is empty or includes set_frozen. Otherwise one wallet approval is required. Do not attach NEAR.',
  'The attested check stays off. There is no OutLayer project here. Do not call request_execution on outlayer.near.',
].join('\n');

if (import.meta.url === `file://${process.argv[1]}`) console.log(GUARD_LIVE_STEPS);
