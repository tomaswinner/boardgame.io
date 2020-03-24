/*
 * Copyright 2018 The boardgame.io Authors
 *
 * Use of this source code is governed by a MIT-style
 * license that can be found in the LICENSE file or at
 * https://opensource.org/licenses/MIT.
 */

import request from 'supertest';

import { addApiToServer, createApiServer } from './api';
import { Game } from '../core/game';
import * as StorageAPI from './db/base';

jest.setTimeout(2000000000);

class AsyncStorage extends StorageAPI.Async {
  public mocks: { [key: string]: jest.Mock };

  constructor(args: any = {}) {
    super();
    const { createGame, fetch, setState, setMetadata, listGames, wipe } = args;
    this.mocks = {
      createGame: createGame || jest.fn(),
      setState: setState || jest.fn(),
      fetch: fetch || jest.fn(() => ({})),
      setMetadata: setMetadata || jest.fn(),
      listGames: listGames || jest.fn(() => []),
      wipe: wipe || jest.fn(),
    };
  }

  async connect() {}

  async createGame(...args) {
    this.mocks.createGame(...args);
  }

  async fetch(...args) {
    return this.mocks.fetch(...args);
  }

  async setState(...args) {
    this.mocks.setState(...args);
  }

  async setMetadata(...args) {
    this.mocks.setMetadata(...args);
  }

  async wipe(...args) {
    this.mocks.wipe(...args);
  }

  async listGames() {
    return this.mocks.listGames();
  }
}

describe('.createApiServer', () => {
  describe('creating a game', () => {
    let response;
    let app;
    let db;
    let games;

    beforeEach(async () => {
      db = new AsyncStorage();
      games = [
        {
          name: 'foo',
          setup: (_, setupData) =>
            setupData
              ? {
                  colors: setupData.colors,
                }
              : {},
        },
      ];
    });

    describe('for an unprotected lobby server', () => {
      beforeEach(async () => {
        delete process.env.API_SECRET;

        const uuid = () => 'gameID';
        const lobbyConfig = { uuid };
        app = createApiServer({ db, games, lobbyConfig });

        response = await request(app.callback())
          .post('/games/foo/create')
          .send({
            numPlayers: 3,
            setupData: {
              colors: {
                '0': 'green',
                '1': 'red',
              },
            },
          });
      });

      test('is successful', () => {
        expect(response.status).toEqual(200);
      });

      test('creates game data', () => {
        expect(db.mocks.setState).toHaveBeenCalledWith(
          'gameID',
          expect.objectContaining({
            ctx: expect.objectContaining({
              numPlayers: 3,
            }),
          })
        );
      });

      test('passes arbitrary data to game setup', () => {
        expect(db.mocks.setState).toHaveBeenCalledWith(
          'gameID',
          expect.objectContaining({
            G: expect.objectContaining({
              colors: {
                '0': 'green',
                '1': 'red',
              },
            }),
          })
        );
      });

      test('creates game metadata', () => {
        expect(db.mocks.setMetadata).toHaveBeenCalledWith(
          'gameID',
          expect.objectContaining({
            players: expect.objectContaining({
              '0': expect.objectContaining({}),
              '1': expect.objectContaining({}),
            }),
            setupData: expect.objectContaining({
              colors: expect.objectContaining({
                '0': 'green',
                '1': 'red',
              }),
            }),
          })
        );
      });

      test('returns game id', () => {
        expect(response.body.gameID).not.toBeNull();
      });

      describe('without numPlayers', () => {
        beforeEach(async () => {
          response = await request(app.callback()).post('/games/foo/create');
        });

        test('uses default numPlayers', () => {
          expect(db.mocks.setState).toHaveBeenCalledWith(
            'gameID',
            expect.objectContaining({
              ctx: expect.objectContaining({
                numPlayers: 2,
              }),
            })
          );
        });
      });
    });

    describe('for a protected lobby', () => {
      beforeEach(() => {
        process.env.API_SECRET = 'protected';
        app = createApiServer({ db, games });
      });

      describe('without the lobby token', () => {
        beforeEach(async () => {
          response = await request(app.callback()).post('/games/foo/create');
        });

        test('fails', () => {
          expect(response.status).toEqual(403);
        });
      });

      describe('with the lobby token', () => {
        beforeEach(async () => {
          response = await request(app.callback())
            .post('/games/foo/create')
            .set('API-Secret', 'protected');
        });

        test('succeeds', () => {
          expect(response.status).toEqual(200);
        });
      });
    });
  });

  describe('joining a room', () => {
    let response;
    let db;
    let games;
    let credentials;

    beforeEach(() => {
      credentials = 'SECRET';
      games = [Game({ name: 'foo' })];
    });

    describe('for an unprotected lobby', () => {
      beforeEach(() => {
        delete process.env.API_SECRET;
      });

      describe('when the game does not exist', () => {
        beforeEach(async () => {
          db = new AsyncStorage({
            fetch: () => ({ metadata: null }),
          });
          const app = createApiServer({ db, games });

          response = await request(app.callback())
            .post('/games/foo/1/join')
            .send('playerID=0&playerName=alice');
        });

        test('throws a "not found" error', async () => {
          expect(response.status).toEqual(404);
        });
      });

      describe('when the game does exist', () => {
        beforeEach(async () => {
          db = new AsyncStorage({
            fetch: async () => {
              return {
                metadata: {
                  players: {
                    '0': {},
                  },
                },
              };
            },
          });
        });

        describe('when the playerID is available', () => {
          beforeEach(async () => {
            const app = createApiServer({
              db,
              games,
              lobbyConfig: {
                uuid: () => 'gameID',
              },
              generateCredentials: () => credentials,
            });
            response = await request(app.callback())
              .post('/games/foo/1/join')
              .send('playerID=0&playerName=alice');
          });

          test('is successful', async () => {
            expect(response.status).toEqual(200);
          });

          test('returns the player credentials', async () => {
            expect(response.body.playerCredentials).toEqual(credentials);
          });

          test('updates the player name', async () => {
            expect(db.mocks.setMetadata).toHaveBeenCalledWith(
              '1',
              expect.objectContaining({
                players: expect.objectContaining({
                  '0': expect.objectContaining({
                    name: 'alice',
                  }),
                }),
              })
            );
          });
        });

        describe('when the playerID does not exist', () => {
          beforeEach(async () => {
            const app = createApiServer({ db, games });
            response = await request(app.callback())
              .post('/games/foo/1/join')
              .send('playerID=1&playerName=alice');
          });

          test('throws error 404', async () => {
            expect(response.status).toEqual(404);
          });
        });

        describe('when playerID is omitted', () => {
          beforeEach(async () => {
            const app = createApiServer({ db, games });
            response = await request(app.callback())
              .post('/games/foo/1/join')
              .send('playerName=1');
          });

          test('throws error 403', async () => {
            expect(response.status).toEqual(403);
          });
        });

        describe('when playerName is omitted', () => {
          beforeEach(async () => {
            const app = createApiServer({ db, games });
            response = await request(app.callback())
              .post('/games/foo/1/join')
              .send('playerID=1');
          });

          test('throws error 403', async () => {
            expect(response.status).toEqual(403);
          });
        });

        describe('when the playerID is not available', () => {
          beforeEach(async () => {
            db = new AsyncStorage({
              fetch: async () => {
                return {
                  metadata: {
                    players: {
                      '0': {
                        credentials,
                        name: 'bob',
                      },
                    },
                  },
                };
              },
            });

            const app = createApiServer({ db, games });

            response = await request(app.callback())
              .post('/games/foo/1/join')
              .send('playerID=0&playerName=alice');
          });
          test('throws error 409', async () => {
            expect(response.status).toEqual(409);
          });
        });
      });
    });
  });

  describe('rename', () => {
    let response;
    let db;
    let games;

    beforeEach(() => {
      games = [Game({ name: 'foo' })];
    });

    describe('for an unprotected lobby', () => {
      beforeEach(() => {
        delete process.env.API_SECRET;
      });

      describe('when the game does not exist', () => {
        test('throws a "not found" error', async () => {
          db = new AsyncStorage({
            fetch: async () => ({ metadata: null }),
          });
          const app = createApiServer({ db, games });
          response = await request(app.callback())
            .post('/games/foo/1/rename')
            .send('playerID=0&playerName=alice&newName=ali');
          expect(response.status).toEqual(404);
        });
      });

      describe('when the game does exist', () => {
        describe('when the playerID does exist', () => {
          beforeEach(async () => {
            db = new AsyncStorage({
              fetch: async () => {
                return {
                  metadata: {
                    players: {
                      '0': {
                        name: 'alice',
                        credentials: 'SECRET1',
                      },
                      '1': {
                        name: 'bob',
                        credentials: 'SECRET2',
                      },
                    },
                  },
                };
              },
            });
            const app = createApiServer({ db, games });
            response = await request(app.callback())
              .post('/games/foo/1/rename')
              .send('playerID=0&credentials=SECRET1&newName=ali');
          });

          test('is successful', async () => {
            expect(response.status).toEqual(200);
          });

          test('updates the players', async () => {
            expect(db.mocks.setMetadata).toHaveBeenCalledWith(
              '1',
              expect.objectContaining({
                players: expect.objectContaining({
                  '0': expect.objectContaining({
                    name: 'ali',
                  }),
                }),
              })
            );
          });
        });

        describe('when the playerID does not exist', () => {
          test('throws error 404', async () => {
            const app = createApiServer({ db, games });
            response = await request(app.callback())
              .post('/games/foo/1/rename')
              .send('playerID=2&credentials=SECRET1&newName=joe');
            expect(response.status).toEqual(404);
          });
        });

        describe('when the credentials are invalid', () => {
          test('throws error 404', async () => {
            const app = createApiServer({ db, games });
            response = await request(app.callback())
              .post('/games/foo/1/rename')
              .send('playerID=0&credentials=SECRET2&newName=mike');
            expect(response.status).toEqual(403);
          });
        });
        describe('when playerID is omitted', () => {
          beforeEach(async () => {
            const app = createApiServer({ db, games });
            response = await request(app.callback())
              .post('/games/foo/1/rename')
              .send('credentials=foo&newName=bill');
          });

          test('throws error 403', async () => {
            expect(response.status).toEqual(403);
          });
          describe('when newName is omitted', () => {
            beforeEach(async () => {
              const app = createApiServer({ db, games });
              response = await request(app.callback())
                .post('/games/foo/1/rename')
                .send('credentials=foo&playerID=0');
            });

            test('throws error 403', async () => {
              expect(response.status).toEqual(403);
            });
          });
        });
      });
    });
  });

  describe('leaving a room', () => {
    let response;
    let db;
    let games;

    beforeEach(() => {
      games = [Game({ name: 'foo' })];
    });

    describe('for an unprotected lobby', () => {
      beforeEach(() => {
        delete process.env.API_SECRET;
      });

      describe('when the game does not exist', () => {
        test('throws a "not found" error', async () => {
          db = new AsyncStorage({
            fetch: async () => ({ metadata: null }),
          });
          const app = createApiServer({ db, games });
          response = await request(app.callback())
            .post('/games/foo/1/leave')
            .send('playerID=0&playerName=alice');
          expect(response.status).toEqual(404);
        });
      });

      describe('when the game does exist', () => {
        describe('when the playerID does exist', () => {
          beforeEach(async () => {
            db = new AsyncStorage({
              fetch: async () => {
                return {
                  metadata: {
                    players: {
                      '0': {
                        name: 'alice',
                        credentials: 'SECRET1',
                      },
                      '1': {
                        name: 'bob',
                        credentials: 'SECRET2',
                      },
                    },
                  },
                };
              },
            });
            const app = createApiServer({ db, games });
            response = await request(app.callback())
              .post('/games/foo/1/leave')
              .send('playerID=0&credentials=SECRET1');
          });

          test('is successful', async () => {
            expect(response.status).toEqual(200);
          });

          test('updates the players', async () => {
            expect(db.mocks.setMetadata).toHaveBeenCalledWith(
              '1',
              expect.objectContaining({
                players: expect.objectContaining({
                  '0': expect.objectContaining({}),
                  '1': expect.objectContaining({
                    name: 'bob',
                    credentials: 'SECRET2',
                  }),
                }),
              })
            );
          });

          describe('when there are not players left', () => {
            test('removes the game', async () => {
              db = new AsyncStorage({
                fetch: async () => {
                  return {
                    metadata: {
                      players: {
                        '0': {
                          name: 'alice',
                          credentials: 'SECRET1',
                        },
                        '1': {
                          credentials: 'SECRET2',
                        },
                      },
                    },
                  };
                },
              });
              const app = createApiServer({ db, games });
              response = await request(app.callback())
                .post('/games/foo/1/leave')
                .send('playerID=0&credentials=SECRET1');
              expect(db.mocks.wipe).toHaveBeenCalledWith('1');
            });
          });
        });

        describe('when the playerID does not exist', () => {
          test('throws error 404', async () => {
            const app = createApiServer({ db, games });
            response = await request(app.callback())
              .post('/games/foo/1/leave')
              .send('playerID=2&credentials=SECRET1');
            expect(response.status).toEqual(404);
          });
        });

        describe('when the credentials are invalid', () => {
          test('throws error 404', async () => {
            const app = createApiServer({ db, games });
            response = await request(app.callback())
              .post('/games/foo/1/leave')
              .send('playerID=0&credentials=SECRET2');
            expect(response.status).toEqual(403);
          });
        });
        describe('when playerID is omitted', () => {
          beforeEach(async () => {
            const app = createApiServer({ db, games });
            response = await request(app.callback())
              .post('/games/foo/1/leave')
              .send('credentials=foo');
          });

          test('throws error 403', async () => {
            expect(response.status).toEqual(403);
          });
        });
      });
    });
  });

  describe('requesting game list', () => {
    let db;
    beforeEach(() => {
      delete process.env.API_SECRET;
      db = new AsyncStorage();
    });

    describe('when given 2 games', () => {
      let response;
      beforeEach(async () => {
        let app;
        let games;
        games = [Game({ name: 'foo' }), { name: 'bar' }];
        app = createApiServer({ db, games });

        response = await request(app.callback()).get('/games');
      });

      test('should get 2 games', async () => {
        expect(JSON.parse(response.text)).toEqual(['foo', 'bar']);
      });
    });
  });

  describe('play again', () => {
    let response;
    let db;
    let games;

    beforeEach(() => {
      games = [Game({ name: 'foo' })];
      delete process.env.API_SECRET;
      db = new AsyncStorage({
        fetch: async () => {
          return {
            metadata: {
              players: {
                '0': {
                  name: 'alice',
                  credentials: 'SECRET1',
                },
                '1': {
                  name: 'bob',
                  credentials: 'SECRET2',
                },
              },
            },
          };
        },
      });
    });

    test('creates new game data', async () => {
      const lobbyConfig = {
        uuid: () => 'newGameID',
      };
      const app = createApiServer({ db, games, lobbyConfig });
      response = await request(app.callback())
        .post('/games/foo/1/playAgain')
        .send('playerID=0&credentials=SECRET1&numPlayers=4');
      expect(db.mocks.setState).toHaveBeenCalledWith(
        'newGameID',
        expect.objectContaining({
          ctx: expect.objectContaining({
            numPlayers: 4,
          }),
        })
      );
      expect(response.body.nextRoomID).toBe('newGameID');
    });

    test('fetches next id', async () => {
      db = new AsyncStorage({
        fetch: async () => {
          return {
            metadata: {
              players: {
                '0': {
                  name: 'alice',
                  credentials: 'SECRET1',
                },
                '1': {
                  name: 'bob',
                  credentials: 'SECRET2',
                },
              },
              nextRoomID: '12345',
            },
          };
        },
      });
      const app = createApiServer({ db, games });
      response = await request(app.callback())
        .post('/games/foo/1/playAgain')
        .send('playerID=0&credentials=SECRET1');
      expect(response.body.nextRoomID).toBe('12345');
    });

    test('when the game does not exist throws a "not found" error', async () => {
      db = new AsyncStorage({
        fetch: async () => ({ metadata: null }),
      });
      const app = createApiServer({ db, games });
      response = await request(app.callback())
        .post('/games/foo/1/playAgain')
        .send('playerID=0&playerName=alice');
      expect(response.status).toEqual(404);
    });

    test('when the playerID is undefnied throws error 403', async () => {
      const app = createApiServer({ db, games });
      response = await request(app.callback())
        .post('/games/foo/1/playAgain')
        .send('credentials=SECRET1');
      expect(response.status).toEqual(403);
    });

    test('when the playerID does not exist throws error 404', async () => {
      const app = createApiServer({ db, games });
      response = await request(app.callback())
        .post('/games/foo/1/playAgain')
        .send('playerID=2&credentials=SECRET1');
      expect(response.status).toEqual(404);
    });

    test('when the credentials are invalid throws error 404', async () => {
      const app = createApiServer({ db, games });
      response = await request(app.callback())
        .post('/games/foo/1/playAgain')
        .send('playerID=0&credentials=SECRET2');
      expect(response.status).toEqual(403);
    });

    test('when playerID is omitted throws error 403', async () => {
      const app = createApiServer({ db, games });
      response = await request(app.callback())
        .post('/games/foo/1/leave')
        .send('credentials=foo');
      expect(response.status).toEqual(403);
    });
  });

  describe('requesting room list', () => {
    let db;
    beforeEach(() => {
      delete process.env.API_SECRET;
      db = new AsyncStorage({
        fetch: async () => {
          return {
            metadata: {
              players: {
                '0': {
                  id: 0,
                  credentials: 'SECRET1',
                },
                '1': {
                  id: 1,
                  credentials: 'SECRET2',
                },
              },
            },
          };
        },
        listGames: async () => {
          return ['bar-0', 'bar-1'];
        },
      });
    });
    describe('when given 2 rooms', () => {
      let response;
      let rooms;
      beforeEach(async () => {
        let games = [Game({ name: 'foo' }), { name: 'bar' }];
        let app = createApiServer({ db, games });
        response = await request(app.callback()).get('/games/bar');
        rooms = JSON.parse(response.text).rooms;
      });

      test('returns instances of the selected room', async () => {
        expect(rooms).toHaveLength(2);
      });

      test('returns room ids', async () => {
        expect(rooms[0].gameID).toEqual('bar-0');
        expect(rooms[1].gameID).toEqual('bar-1');
      });

      test('returns player names', async () => {
        expect(rooms[0].players).toEqual([{ id: 0 }, { id: 1 }]);
        expect(rooms[1].players).toEqual([{ id: 0 }, { id: 1 }]);
      });
    });
  });

  describe('requesting room', () => {
    let db;
    beforeEach(() => {
      delete process.env.API_SECRET;
      db = new AsyncStorage({
        fetch: async () => {
          return {
            metadata: {
              players: {
                '0': {
                  id: 0,
                  credentials: 'SECRET1',
                },
                '1': {
                  id: 1,
                  credentials: 'SECRET2',
                },
              },
            },
          };
        },
        list: async () => {
          return ['bar:bar-0', 'foo:foo-0', 'bar:bar-1'];
        },
      });
    });

    describe('when given room ID', () => {
      let response;
      let room;
      beforeEach(async () => {
        let games = [Game({ name: 'foo' }), { name: 'bar' }];
        let app = createApiServer({ db, games });
        response = await request(app.callback()).get('/games/bar/bar-0');
        room = JSON.parse(response.text);
      });

      test('returns game ids', async () => {
        expect(room.roomID).toEqual('bar-0');
      });

      test('returns player names', async () => {
        expect(room.players).toEqual([{ id: 0 }, { id: 1 }]);
      });
    });

    describe('when given a non-existent room ID', () => {
      let response;
      beforeEach(async () => {
        db = new AsyncStorage({
          fetch: async () => ({ metadata: null }),
        });
        let games = [Game({ name: 'foo' })];
        let app = createApiServer({ db, games });
        response = await request(app.callback()).get('/games/bar/doesnotexist');
      });

      test('throws error 404', async () => {
        expect(response.status).toEqual(404);
      });
    });
  });
});

describe('.addApiToServer', () => {
  describe('when server app is provided', () => {
    let db;
    let server;
    let useChain;
    let games;

    beforeEach(async () => {
      useChain = jest.fn(() => ({ use: useChain }));
      server = { use: useChain };
      db = new AsyncStorage();
      games = [
        {
          name: 'foo',
          setup: () => {},
        },
      ];
    });

    test('call .use method several times', async () => {
      addApiToServer({ app: server, db, games });
      expect(server.use.mock.calls.length).toBeGreaterThan(1);
    });

    test('call .use method several times with uuid', async () => {
      const uuid = () => 'foo';
      addApiToServer({ app: server, db, games, lobbyConfig: { uuid } });
      expect(server.use.mock.calls.length).toBeGreaterThan(1);
    });
  });
});
