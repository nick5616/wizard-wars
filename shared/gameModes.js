/**
 * Single-player-vs-bots match configs, shared between client (mode picker
 * UI) and server (Room.setupMatch team/spawn assignment). The human player
 * always fills team 0's first slot; every other slot across every team is
 * a bot -- see Room.setupMatch.
 */
export const GAME_MODES = {
  ffa5: {
    id: 'ffa5',
    label: '1v1v1v1v1',
    description: 'Free-for-all. Every wizard for themself.',
    teamSizes: [1, 1, 1, 1, 1],
  },
  teams2v2: {
    id: 'teams2v2',
    label: '2v2',
    description: 'You and an ally against a rival duo.',
    teamSizes: [2, 2],
  },
  teams5v5: {
    id: 'teams5v5',
    label: '5v5',
    description: 'Two full squads clash.',
    teamSizes: [5, 5],
  },
  sixteams2: {
    id: 'sixteams2',
    label: '2v2v2v2v2v2',
    description: 'Six duos, one arena, everybody for their pair.',
    teamSizes: [2, 2, 2, 2, 2, 2],
  },
};

export const GAME_MODE_ORDER = ['ffa5', 'teams2v2', 'teams5v5', 'sixteams2'];
