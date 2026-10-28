// Ultimate's MFL client: the shared common/ client with this league's host.
// Callers pass SEASON_YEAR and LEAGUE_ID from config.js.
import { MflCommishClient as SharedMflCommishClient } from '../common/mfl_commish_client.js';
import { MFL_HOST } from './config.js';

const USER_AGENT = 'UltimateGuillotineCommish/1.0 (+https://github.com/c0d3rj03/fantasy-football)';

export class MflCommishClient extends SharedMflCommishClient {
  constructor(seasonYear, leagueId, host = MFL_HOST) {
    super(seasonYear, leagueId, host, { userAgent: USER_AGENT });
  }
}

export default MflCommishClient;
