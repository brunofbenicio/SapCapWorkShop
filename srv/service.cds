using { Benicio_1_04 as my } from '../db/schema.cds';

@path: '/service/benicio_1_04'
@requires: 'authenticated-user'
service benicio_1_04Srv {
  @odata.draft.enabled
  entity CustomerMessages as projection on my.CustomerMessages;
}