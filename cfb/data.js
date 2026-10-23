// Gridiron Glory - static data + helpers. Everything is a global on window.GG.
(function () {
  'use strict';
  var GG = window.GG = window.GG || {};

  GG.rand = function (a, b) { return a + Math.random() * (b - a); };
  GG.ri = function (a, b) { return Math.floor(GG.rand(a, b + 1)); };
  GG.pick = function (arr) { return arr[Math.floor(Math.random() * arr.length)]; };
  GG.clamp = function (v, a, b) { return v < a ? a : v > b ? b : v; };
  GG.shuffle = function (a) { for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)); var t = a[i]; a[i] = a[j]; a[j] = t; } return a; };

  // name, abbreviation, primary, secondary, prestige (1-5 stars), conference, state
  GG.COLLEGES = [
    ['Tuscaloosa Tide', 'TUS', '#9e1b32', '#ffffff', 5, 'SEC', 'AL'],
    ['Athens Bulldogs', 'ATH', '#ba0c2f', '#000000', 5, 'SEC', 'GA'],
    ['Columbus Bucks', 'COL', '#bb0000', '#a7b1b7', 5, 'Big Ten', 'OH'],
    ['Austin Longhorns', 'AUS', '#bf5700', '#ffffff', 5, 'SEC', 'TX'],
    ['Ann Arbor Wolves', 'ANN', '#00274c', '#ffcb05', 5, 'Big Ten', 'MI'],
    ['Baton Rouge Tigers', 'BTR', '#461d7c', '#fdd023', 4, 'SEC', 'LA'],
    ['Eugene Ducks', 'EUG', '#154733', '#fee123', 5, 'Big Ten', 'OR'],
    ['South Bend Irish', 'SBI', '#0c2340', '#c99700', 4, 'Indep', 'IN'],
    ['Clemson Paws', 'CLE', '#f56600', '#522d80', 4, 'ACC', 'SC'],
    ['Happy Valley Lions', 'HVL', '#041e42', '#ffffff', 4, 'Big Ten', 'PA'],
    ['Norman Sooners', 'NOR', '#841617', '#fdf9d8', 4, 'SEC', 'OK'],
    ['Gainesville Gators', 'GNV', '#0021a5', '#fa4616', 4, 'SEC', 'FL'],
    ['Tallahassee Noles', 'TLH', '#782f40', '#ceb888', 4, 'ACC', 'FL'],
    ['Los Angeles Trojans', 'LAT', '#990000', '#ffc72c', 4, 'Big Ten', 'CA'],
    ['Knoxville Vols', 'KNX', '#ff8200', '#ffffff', 4, 'SEC', 'TN'],
    ['Miami Storm', 'MIA', '#f47321', '#005030', 4, 'ACC', 'FL'],
    ['Auburn Plains', 'AUB', '#0c2340', '#e87722', 3, 'SEC', 'AL'],
    ['Salt Lake Utes', 'SLC', '#cc0000', '#ffffff', 3, 'Big 12', 'UT'],
    ['Provo Cougars', 'PRV', '#002e5d', '#ffffff', 3, 'Big 12', 'UT'],
    ['Madison Badgers', 'MAD', '#c5050c', '#ffffff', 3, 'Big Ten', 'WI'],
    ['Lincoln Huskers', 'LIN', '#e41c38', '#f5f1e7', 3, 'Big Ten', 'NE'],
    ['Seattle Huskies', 'SEA', '#4b2e83', '#b7a57a', 3, 'Big Ten', 'WA'],
    ['College Station Aggies', 'CST', '#500000', '#ffffff', 3, 'SEC', 'TX'],
    ['Boulder Buffs', 'BLD', '#cfb87c', '#000000', 3, 'Big 12', 'CO'],
    ['Stillwater Pokes', 'STW', '#ff7300', '#000000', 3, 'Big 12', 'OK'],
    ['Iowa City Hawks', 'IAC', '#ffcd00', '#000000', 3, 'Big Ten', 'IA'],
    ['Lexington Cats', 'LEX', '#0033a0', '#ffffff', 2, 'SEC', 'KY'],
    ['Boise Broncos', 'BOI', '#0033a0', '#d64309', 2, 'MWC', 'ID'],
    ['Tempe Devils', 'TMP', '#8c1d40', '#ffc627', 2, 'Big 12', 'AZ'],
    ['Lubbock Raiders', 'LUB', '#cc0000', '#000000', 2, 'Big 12', 'TX'],
    ['Louisville Cards', 'LOU', '#ad0000', '#000000', 2, 'ACC', 'KY'],
    ['Blacksburg Hokies', 'BKS', '#630031', '#cf4420', 2, 'ACC', 'VA'],
    ['Orlando Knights', 'ORL', '#000000', '#ffc904', 2, 'Big 12', 'FL'],
    ['Durham Devils', 'DUR', '#003087', '#ffffff', 1, 'ACC', 'NC'],
    ['Hattiesburg Eagles', 'HAT', '#000000', '#ffab00', 1, 'Sun Belt', 'MS'],
    ['Boone Mountaineers', 'BOO', '#222222', '#ffcc00', 1, 'Sun Belt', 'NC'],
    ['Toledo Rockets', 'TOL', '#15397f', '#ffda00', 1, 'MAC', 'OH'],
    ['El Paso Miners', 'ELP', '#ff8200', '#041e42', 1, 'CUSA', 'TX'],
    ['Laramie Pokes', 'LAR', '#492f24', '#ffc425', 1, 'MWC', 'WY'],
    ['Kent Flashes', 'KEN', '#002664', '#eaab00', 1, 'MAC', 'OH']
  ].map(function (c, i) {
    return { id: i, name: c[0], ab: c[1], c1: c[2], c2: c[3], prestige: c[4], conf: c[5], state: c[6] };
  });

  GG.PROS = [
    ['Kansas City Kings', 'KC', '#e31837', '#ffb81c'], ['Buffalo Bison', 'BUF', '#00338d', '#c60c30'],
    ['Philadelphia Liberty', 'PHI', '#004c54', '#a5acaf'], ['Detroit Motors', 'DET', '#0076b6', '#b0b7bc'],
    ['San Francisco Gold', 'SF', '#aa0000', '#b3995d'], ['Baltimore Ravens', 'BAL', '#241773', '#9e7c0c'],
    ['Dallas Stars', 'DAL', '#041e42', '#869397'], ['Green Bay Pack', 'GB', '#203731', '#ffb612'],
    ['Miami Surf', 'MIA', '#008e97', '#fc4c02'], ['Cincinnati Stripes', 'CIN', '#fb4f14', '#000000'],
    ['Houston Oilers', 'HOU', '#03202f', '#a71930'], ['Los Angeles Rams', 'LA', '#003594', '#ffd100'],
    ['Seattle Sound', 'SEA', '#002244', '#69be28'], ['Chicago Monsters', 'CHI', '#0b162a', '#c83803'],
    ['New York Titans', 'NY', '#0b2265', '#a71930'], ['Denver Peaks', 'DEN', '#fb4f14', '#002244'],
    ['Pittsburgh Steel', 'PIT', '#101820', '#ffb612'], ['Minnesota Norse', 'MIN', '#4f2683', '#ffc62f'],
    ['Atlanta Flight', 'ATL', '#a71930', '#000000'], ['Carolina Cats', 'CAR', '#0085ca', '#101820'],
    ['Las Vegas Aces', 'LV', '#000000', '#a5acaf'], ['Cleveland Dawgs', 'CLE', '#311d00', '#ff3c00'],
    ['Jacksonville Jags', 'JAX', '#006778', '#d7a22a'], ['Tennessee Flames', 'TEN', '#0c2340', '#4b92db']
  ].map(function (c, i) { return { id: i, name: c[0], ab: c[1], c1: c[2], c2: c[3], rating: GG.ri(66, 88) }; });

  GG.HS = ['Central', 'North', 'Westside', 'Eastview', 'Lakeside', 'Valley', 'Ridge', 'Riverside', 'St. Mark', 'Oak Hill', 'Pinecrest', 'Southfield'];
  GG.MASCOTS = ['Eagles', 'Wildcats', 'Panthers', 'Rams', 'Knights', 'Hornets', 'Bears', 'Falcons', 'Mustangs', 'Titans'];
  GG.STATES = ['AL', 'AZ', 'CA', 'CO', 'FL', 'GA', 'IA', 'ID', 'IN', 'KY', 'LA', 'MI', 'MS', 'NC', 'NE', 'OH', 'OK', 'OR', 'PA', 'SC', 'TN', 'TX', 'UT', 'VA', 'WA', 'WI', 'WY'];
  GG.FIRST = ['Jalen', 'Caleb', 'Marcus', 'Tyler', 'Devin', 'Bryce', 'Jaylen', 'Cam', 'Drew', 'Malik', 'Trey', 'Zion', 'Jordan', 'Isaiah', 'Elijah', 'Darius', 'Mason', 'Hunter', 'Quinn', 'Andre', 'Xavier', 'Tre', 'Kobe', 'Luke', 'Jace', 'Brock', 'Dante', 'Rashad', 'Omar', 'Colt'];
  GG.LAST = ['Williams', 'Johnson', 'Smith', 'Brown', 'Jackson', 'Davis', 'Harris', 'Thomas', 'Moore', 'Walker', 'Allen', 'Young', 'King', 'Wright', 'Hill', 'Green', 'Adams', 'Baker', 'Nelson', 'Carter', 'Mitchell', 'Turner', 'Parker', 'Evans', 'Collins', 'Stewart', 'Reed', 'Brooks', 'Price', 'Bell'];
  GG.name = function () { return GG.pick(GG.FIRST) + ' ' + GG.pick(GG.LAST); };

  // Player attributes per position (career mode). Order = display order.
  GG.ATTRS = {
    QB: [['arm', 'Arm Power'], ['acc', 'Accuracy'], ['awr', 'Pocket Awareness'], ['spd', 'Speed']],
    RB: [['spd', 'Speed'], ['str', 'Break Tackle'], ['agi', 'Agility'], ['hnd', 'Hands']],
    WR: [['spd', 'Speed'], ['hnd', 'Hands'], ['rte', 'Route Running'], ['agi', 'Agility']]
  };
  GG.WEIGHTS = {
    QB: { arm: .3, acc: .4, awr: .2, spd: .1 },
    RB: { spd: .35, str: .25, agi: .3, hnd: .1 },
    WR: { spd: .3, hnd: .35, rte: .25, agi: .1 }
  };
  GG.ARCH = {
    QB: { 'Pocket Passer': { arm: 4, acc: 6, awr: 5, spd: -6 }, 'Dual Threat': { arm: 2, acc: -2, awr: 0, spd: 8 }, 'Gunslinger': { arm: 9, acc: -1, awr: 1, spd: -2 } },
    RB: { 'Power Back': { spd: -3, str: 9, agi: -2, hnd: 0 }, 'Speed Back': { spd: 8, str: -5, agi: 4, hnd: 0 }, 'Receiving Back': { spd: 2, str: -2, agi: 3, hnd: 8 } },
    WR: { 'Deep Threat': { spd: 9, hnd: 0, rte: -2, agi: 1 }, 'Possession': { spd: -3, hnd: 9, rte: 4, agi: 0 }, 'Route Technician': { spd: 0, hnd: 2, rte: 9, agi: 3 } }
  };
  GG.ovr = function (p) {
    var w = GG.WEIGHTS[p.pos], s = 0;
    for (var k in w) s += (p.at[k] || 60) * w[k];
    return Math.round(s);
  };
  GG.starsFor = function (ovr) { return ovr >= 84 ? 5 : ovr >= 76 ? 4 : ovr >= 68 ? 3 : ovr >= 60 ? 2 : 1; };
  GG.starStr = function (n) { var s = ''; for (var i = 0; i < 5; i++) s += i < n ? '&#9733;' : '&#9734;'; return s; };
})();
