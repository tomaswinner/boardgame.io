/*
 * Copyright 2018 The boardgame.io Authors.
 *
 * Use of this source code is governed by a MIT-style
 * license that can be found in the LICENSE file or at
 * https://opensource.org/licenses/MIT.
 */

import Militia from './militia';
import Simulator from './simulator';

const routes = [
  {
    path: '/turnorder/main',
    text: 'Simulator',
    component: Simulator,
  },
  {
    path: '/turnorder/militia',
    text: 'Militia',
    component: Militia,
  },
];

export default {
  routes,
};
