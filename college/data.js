/* Saturday Gridiron - data.js
   Static content: the league, its five conferences and forty schools.
   Every school sits in a real college town, but every school name,
   mascot, conference, bowl and trophy here is made up.
   Loaded first; everything hangs off window.SG. ASCII only. */
(function () {
'use strict';
var SG = window.SG = window.SG || {};

SG.LEAGUE = { name: 'National Collegiate Gridiron Association', short: 'NCGA' };
SG.PLAYOFF_NAME = 'NCGA Final Eight';
SG.TITLE_GAME = 'Gridiron Classic';
SG.AWARD = 'Golden Helmet Trophy';
SG.START_YEAR = 2026;

// Conference order matters: teams are listed in rival pairs so the
// round-robin builder can put every rivalry in the final week.
SG.CONFS = [
  { id: 'mag', name: 'Magnolia League', short: 'MAG', region: 'Deep South' },
  { id: 'irn', name: 'Iron League', short: 'IRON', region: 'Midwest' },
  { id: 'pln', name: 'Lone Plains League', short: 'PLNS', region: 'Plains' },
  { id: 'tdw', name: 'Tidewater League', short: 'TIDE', region: 'East Coast' },
  { id: 'sun', name: 'Sundown League', short: 'SUN', region: 'West' }
];

// abbr, city, state, mascot, primary, secondary, prestige (1-5)
// Rows come in rival pairs: [0]-[1], [2]-[3], [4]-[5], [6]-[7].
var RAW = {
  mag: [
    ['TUS', 'Tuscaloosa', 'AL', 'Thunder', '#1b2a6b', '#ffd23f', 5],
    ['AUB', 'Auburn', 'AL', 'Foxes', '#d35400', '#1c1c1c', 4],
    ['ATH', 'Athens', 'GA', 'Olympians', '#5a2d82', '#e8c547', 5],
    ['GNV', 'Gainesville', 'FL', 'Swamp Hawks', '#2e6b30', '#f39c12', 4],
    ['KNX', 'Knoxville', 'TN', 'Ridgebacks', '#6b3e1f', '#f5d6a1', 4],
    ['OXF', 'Oxford', 'MS', 'Riverboats', '#0d47a1', '#e53935', 3],
    ['BTR', 'Baton Rouge', 'LA', 'Cranes', '#127c7c', '#f2f2f2', 4],
    ['CLA', 'Columbia', 'SC', 'Palmettos', '#1e5b4f', '#e0c27a', 3]
  ],
  irn: [
    ['CMB', 'Columbus', 'OH', 'Comets', '#263238', '#ff7043', 5],
    ['ANN', 'Ann Arbor', 'MI', 'Arrows', '#00695c', '#ffca28', 5],
    ['STC', 'State College', 'PA', 'Ironmen', '#37474f', '#ffb300', 4],
    ['MAD', 'Madison', 'WI', 'Muskies', '#0277bd', '#ffeb3b', 4],
    ['ICY', 'Iowa City', 'IA', 'Pheasants', '#6d4c41', '#ff8a65', 3],
    ['LIN', 'Lincoln', 'NE', 'Stampede', '#33691e', '#fff176', 3],
    ['ELA', 'East Lansing', 'MI', 'Centurions', '#7b1fa2', '#ffd54f', 3],
    ['BLM', 'Bloomington', 'IN', 'Blizzard', '#e8eef2', '#1e88e5', 2]
  ],
  pln: [
    ['AUS', 'Austin', 'TX', 'Armadillos', '#5d4037', '#ffab40', 5],
    ['CST', 'College Station', 'TX', 'Stallions', '#212121', '#c62828', 4],
    ['NOR', 'Norman', 'OK', 'Twisters', '#546e7a', '#ff5252', 5],
    ['STW', 'Stillwater', 'OK', 'Prairie Dogs', '#00838f', '#ffcc80', 3],
    ['LUB', 'Lubbock', 'TX', 'Dust Devils', '#bf360c', '#ffe0b2', 3],
    ['WAC', 'Waco', 'TX', 'Wranglers', '#1b5e20', '#ffd600', 3],
    ['MHK', 'Manhattan', 'KS', 'Harvesters', '#f9a825', '#4e342e', 2],
    ['FTW', 'Fort Worth', 'TX', 'Outlaws', '#2b2b2b', '#e0e0e0', 3]
  ],
  tdw: [
    ['CLM', 'Clemson', 'SC', 'Copperheads', '#a0522d', '#2e7d32', 5],
    ['TAL', 'Tallahassee', 'FL', 'Torches', '#e65100', '#263238', 4],
    ['MIA', 'Miami', 'FL', 'Manatees', '#4fc3f7', '#ec407a', 4],
    ['CHH', 'Chapel Hill', 'NC', 'Herons', '#283593', '#e0f7fa', 3],
    ['BBG', 'Blacksburg', 'VA', 'Ridgerunners', '#6a1b9a', '#ff9800', 3],
    ['LOU', 'Louisville', 'KY', 'Thoroughbreds', '#1a237e', '#ff6f00', 3],
    ['SBN', 'South Bend', 'IN', 'Sentinels', '#263238', '#26c6da', 4],
    ['SYR', 'Syracuse', 'NY', 'Salt Kings', '#eceff1', '#5e35b1', 2]
  ],
  sun: [
    ['LAX', 'Los Angeles', 'CA', 'Breakers', '#0091ea', '#ffd600', 5],
    ['BRK', 'Berkeley', 'CA', 'Redwoods', '#8e2b1f', '#c5e1a5', 3],
    ['EUG', 'Eugene', 'OR', 'Sasquatch', '#2e7d32', '#a1887f', 4],
    ['SEA', 'Seattle', 'WA', 'Orcas', '#102027', '#b3e5fc', 4],
    ['SLC', 'Salt Lake City', 'UT', 'Peaks', '#b71c1c', '#eceff1', 3],
    ['PRV', 'Provo', 'UT', 'Peregrines', '#0d47a1', '#eceff1', 3],
    ['BLD', 'Boulder', 'CO', 'Bighorns', '#4e342e', '#ffd54f', 3],
    ['TMP', 'Tempe', 'AZ', 'Scorpions', '#ad1457', '#ffca28', 3]
  ]
};

SG.TEAMS = [];
SG.CONFS.forEach(function (c, ci) {
  c.teams = [];
  RAW[c.id].forEach(function (r, k) {
    var t = {
      i: SG.TEAMS.length, abbr: r[0], city: r[1], st: r[2], mascot: r[3],
      name: r[1] + ' ' + r[3], c1: r[4], c2: r[5], basePrestige: r[6],
      conf: ci, slot: k
    };
    c.teams.push(t.i);
    SG.TEAMS.push(t);
  });
  // rival = the other half of the pair
  c.teams.forEach(function (ti, k) { SG.TEAMS[ti].rival = c.teams[k ^ 1]; });
});

SG.BOWLS = ['Harvest Moon Bowl', 'Gulf Breeze Bowl', 'Canyon Bowl', 'Frostbite Bowl',
  'Golden Prairie Bowl', 'Riverboat Bowl', 'Lighthouse Bowl', 'Painted Desert Bowl'];

// Roster shape. Starters are the best N at each position.
SG.POS = ['QB', 'RB', 'WR', 'TE', 'OL', 'K', 'DL', 'LB', 'DB'];
SG.POS_NAME = { QB: 'Quarterback', RB: 'Running Back', WR: 'Wide Receiver', TE: 'Tight End',
  OL: 'Offensive Line', K: 'Kicker', DL: 'Defensive Line', LB: 'Linebacker', DB: 'Defensive Back' };
SG.STARTERS = { QB: 1, RB: 1, WR: 3, TE: 1, OL: 5, K: 1, DL: 4, LB: 3, DB: 4 };
SG.ROSTER_MIN = { QB: 2, RB: 2, WR: 4, TE: 2, OL: 6, K: 1, DL: 5, LB: 4, DB: 5 };
SG.ROSTER_MAX = 34;
SG.YEARS = ['FR', 'SO', 'JR', 'SR'];

// What the "skill" rating means for each position (shown on cards).
SG.SKILL_NAME = { QB: 'ACC', RB: 'HND', WR: 'HND', TE: 'HND', OL: 'BLK', K: 'ACC', DL: 'RSH', LB: 'TKL', DB: 'COV' };
SG.ARM_NAME = { QB: 'ARM', K: 'LEG' };

SG.FIRST = ['Jalen', 'Marcus', 'Tyler', 'Caleb', 'DeShawn', 'Brady', 'Cole', 'Trey', 'Isaiah', 'Mason',
  'Jackson', 'Darius', 'Logan', 'Andre', 'Wyatt', 'Malik', 'Grant', 'Xavier', 'Hunter', 'Jordan',
  'Elijah', 'Bryce', 'Cameron', 'Devin', 'Garrett', 'Hayden', 'Jaylen', 'Kendall', 'Landon', 'Micah',
  'Nolan', 'Owen', 'Peyton', 'Quinn', 'Reggie', 'Shane', 'Terrell', 'Tucker', 'Victor', 'Zach',
  'Amari', 'Beau', 'Colby', 'Dante', 'Emmitt', 'Fletcher', 'Gavin', 'Holden', 'Ivan', 'Jace',
  'Keon', 'Luke', 'Miles', 'Nate', 'Omar', 'Preston', 'Rashad', 'Sawyer', 'Tate', 'Ty'];
SG.LAST = ['Walker', 'Johnson', 'Brooks', 'Carter', 'Mitchell', 'Hayes', 'Bennett', 'Coleman', 'Reed', 'Foster',
  'Griffin', 'Hughes', 'Jenkins', 'Kelly', 'Lawson', 'Morgan', 'Nichols', 'Owens', 'Parker', 'Quinlan',
  'Ramsey', 'Sanders', 'Tatum', 'Underwood', 'Vance', 'Whitaker', 'Young', 'Ziegler', 'Abbott', 'Barlow',
  'Crenshaw', 'Dalton', 'Ellison', 'Fairley', 'Gaines', 'Holloway', 'Irving', 'Jessup', 'Kincaid', 'Lockett',
  'Maddox', 'Norwood', 'Oakley', 'Pruitt', 'Rollins', 'Stokes', 'Thornton', 'Upshaw', 'Vickers', 'Winslow',
  'Yates', 'Booker', 'Calloway', 'Dixon', 'Easley', 'Fenwick', 'Grady', 'Hollins', 'Keller', 'Merritt'];

SG.HOMETOWNS = ['Houston, TX', 'Dallas, TX', 'San Antonio, TX', 'Atlanta, GA', 'Valdosta, GA', 'Miami, FL',
  'Tampa, FL', 'Jacksonville, FL', 'Birmingham, AL', 'Mobile, AL', 'New Orleans, LA', 'Shreveport, LA',
  'Memphis, TN', 'Nashville, TN', 'Jackson, MS', 'Charlotte, NC', 'Raleigh, NC', 'Columbia, SC',
  'Richmond, VA', 'Baltimore, MD', 'Philadelphia, PA', 'Pittsburgh, PA', 'Cleveland, OH', 'Cincinnati, OH',
  'Detroit, MI', 'Chicago, IL', 'Indianapolis, IN', 'St. Louis, MO', 'Kansas City, MO', 'Omaha, NE',
  'Tulsa, OK', 'Oklahoma City, OK', 'Denver, CO', 'Phoenix, AZ', 'Las Vegas, NV', 'Los Angeles, CA',
  'Sacramento, CA', 'San Diego, CA', 'Portland, OR', 'Seattle, WA', 'Salt Lake City, UT', 'Newark, NJ'];

// 3x5 pixel font for the field painter (yard numbers, end zone names).
SG.FONT3 = {
  '0': ['111', '101', '101', '101', '111'], '1': ['010', '110', '010', '010', '111'],
  '2': ['111', '001', '111', '100', '111'], '3': ['111', '001', '111', '001', '111'],
  '4': ['101', '101', '111', '001', '001'], '5': ['111', '100', '111', '001', '111'],
  '6': ['111', '100', '111', '101', '111'], '7': ['111', '001', '010', '010', '010'],
  '8': ['111', '101', '111', '101', '111'], '9': ['111', '101', '111', '001', '111'],
  A: ['010', '101', '111', '101', '101'], B: ['110', '101', '110', '101', '110'],
  C: ['011', '100', '100', '100', '011'], D: ['110', '101', '101', '101', '110'],
  E: ['111', '100', '110', '100', '111'], F: ['111', '100', '110', '100', '100'],
  G: ['011', '100', '101', '101', '011'], H: ['101', '101', '111', '101', '101'],
  I: ['111', '010', '010', '010', '111'], J: ['001', '001', '001', '101', '010'],
  K: ['101', '101', '110', '101', '101'], L: ['100', '100', '100', '100', '111'],
  M: ['101', '111', '111', '101', '101'], N: ['110', '101', '101', '101', '101'],
  O: ['010', '101', '101', '101', '010'], P: ['110', '101', '110', '100', '100'],
  Q: ['010', '101', '101', '110', '011'], R: ['110', '101', '110', '101', '101'],
  S: ['011', '100', '010', '001', '110'], T: ['111', '010', '010', '010', '010'],
  U: ['101', '101', '101', '101', '111'], V: ['101', '101', '101', '101', '010'],
  W: ['101', '101', '111', '111', '101'], X: ['101', '101', '010', '101', '101'],
  Y: ['101', '101', '010', '010', '010'], Z: ['111', '001', '010', '100', '111'],
  ' ': ['000', '000', '000', '000', '000'], '-': ['000', '000', '111', '000', '000'],
  '.': ['000', '000', '000', '000', '010']
};

// Seeded RNG helpers shared by every file.
SG.rand = Math.random;
SG.ri = function (a, b) { return a + Math.floor(SG.rand() * (b - a + 1)); };
SG.rf = function (a, b) { return a + SG.rand() * (b - a); };
SG.pick = function (arr) { return arr[Math.floor(SG.rand() * arr.length)]; };
SG.clamp = function (v, a, b) { return v < a ? a : v > b ? b : v; };
SG.gauss = function () {
  var u = 1 - SG.rand(), v = SG.rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(6.283185307 * v);
};
SG.shuffle = function (arr) {
  for (var i = arr.length - 1; i > 0; i--) {
    var j = Math.floor(SG.rand() * (i + 1)), t = arr[i]; arr[i] = arr[j]; arr[j] = t;
  }
  return arr;
};
SG.stars = function (n, max) {
  var s = '', i, full = Math.round(n);
  for (i = 0; i < (max || 5); i++) s += i < full ? '&#9733;' : '&#9734;';
  return s;
};
SG.esc = function (s) {
  return String(s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
};
})();
