//
// new client comes in
// - create a new player
// - listen for the player dropping connection
// -- when dropped kill the player and stop sending updates to them

// new position received from player
// - update redis with new position

// game state updated
// - loop all players and adjust their position based on current directions
// - update any players that have died due to some condition

// send updated state
// - loop all players that are not dead
// -- determine which players are in their visible radius
// -- send limited player state to th eplayer
// - loop all players that are dead, not notified
// -- let them know they are dead
// -- update player state to notified

// game
// - xbound
// - ybound

// players
// - listid [client unique id]

// player
// - state [ 1=alive; 2=dead; 3=notified]
// - pos [game bounded position of the player]
// - atan [direction the player is moving]
// - color [the rgb value for this player]
// - lastupdate [time stamp last update was received]
// - drop [drop a blob next update]



var app = require('express')();
var http = require('http').Server(app);
var io = require('socket.io')(http);
var path = require('path');
var redis = require('redis');
var bluebird = require('bluebird');
var client =  bluebird.promisifyAll(redis.createClient());

var MAXX = 1000;
var MAXY = 600;

var MAXSIZE = 50;

var ALIVE = 0;
var DEAD = 1;
var NOTIFIED = 2;

var POS = 'pos';
var COLOR = 'color';
var ATAN = 'atan';
var CID = 'cid';
var CLIENTS = 'clients';
var STATE = 'state';
var SIZE = 'size';
var DROP = 'drop';

var OFF = 0;
var ERROR = 1;
var WARNING = 2;
var INFO = 3;
var VERBOSE = 4;

var loglevel = ERROR;

function log(message, level) {
    if (level >= loglevel) {
        console.log(message);
    }
}
function sendStateUpdate() {
    // get the list of clients
    client.hkeysAsync(CLIENTS)
    .then(results => {
        log(results, INFO);
        return Promise.all(results.map(result => {
            log('getting ' + result, INFO);
            return client.hgetallAsync(result);
        }));
    }).catch(err => {
        log('could not get all client data: ' + err, ERROR);
    }).then(clients => {
        // now we should have a list of all the clients in redis
        // with each of their state
        // package them to send
        log('emitting update to clients', VERBOSE);
        log(clients, VERBOSE);
		
        io.emit('sup', clients);
    }).catch(err => {
        log('could not emit ' + err, ERROR);
    });
}

function updateState() {
    // get the keys for each client atan
    return client.hkeysAsync(CLIENTS)
    .then(values => {
        log('got clients ' + values, INFO);
        if (values == null) { return null; }
        return Promise.all(values.map(function (value) {
            log('checking client ' + value, INFO);
            if (value && value != 'undefined') {
                log('looping client ' + value, VERBOSE);
                return Promise.all([
                    value,
                    client.hgetAsync(value, ATAN),
                    client.hgetAsync(value, POS),
                    client.hgetAsync(value, SIZE)
                ]);
            }
        }));
    }).catch(errs => {
        log('unable to get atans ' + errs, ERROR);
    }).then(function (clientstate) {
        // got the client, atan, pos
        log('got atans ' + atans, INFO);
        if (clientstate == null) { return null; }
        // use each to set the client positions
        return Promise.all(clientstate.map(function (value) {
            log('looping atan pos ' + value[0] + ' ' + value[1] + ' ' + value[2], INFO);
			var newPos = updatePos(value[0], value[1], value[2], value[3]);
			log('client ' + value[0] + ' pos ' + newPos.pos + ' state ' + newPos.state, INFO);
			if (newPos.state == ALIVE) {
				client.hsetAsync(value[0], POS, newPos.pos.toString());
				client.hgetAsync(value[0], SIZE)
				.then(s => {
					var f = parseFloat(s);
					if (s < MAXSIZE) {
						client.hincrbyfloatAsync(
							value[0], SIZE,
							1.0 - (f / (1.0 + f)));
					}
				})
			} else {
				 killPlayer(value[0]);
			}
			return newPos;
        }));
    }).catch(errs => {
        log('new position set error ' + errs, ERROR);
    }).then(values => {
        log('new positions set', VERBOSE);
    }).catch(err => {
        log('error setting new position ' + err, ERROR);
    })
}

// detect collisions to update client states
function updatePos(player, atan, pos, size) {
    log('atan ' + atan + ' ' + pos, VERBOSE);

	var SPEED_MULTIPLIER = 5.0;
	var SPEED_BASE = 2.0;

	if (pos == null) return [0,0];

	pos = pos.split(',');
    log(pos[0] + ' ' + pos[1], VERBOSE);

	var multiplier = SPEED_MULTIPLIER * (SPEED_BASE - Math.min(size, MAXSIZE) / MAXSIZE);
	pos[0] -= multiplier * Math.cos(atan);
	pos[1] -= multiplier * Math.sin(atan);

    log(pos[0] + ' ' + pos[1], VERBOSE);

	var dead = false;
	var ret = {};

	if (pos[0] < 0) { dead = true; pos[0] = 0;}
	if (pos[1] < 0) { dead = true; pos[1] = 0;}

	if (pos[0] > MAXX) { dead = true; pos[0] = MAXX;}
	if (pos[1] > MAXY) { dead = true; pos[1] = MAXY;}

	if (dead) {
		log('removing ' + player, INFO);
		client.hset(player, STATE, DEAD);
	}
		
	ret.pos = pos;
	ret.state = dead ? DEAD : ALIVE;
	return ret;
}

function killPlayer(player) {
	// send death notice to player
	// convert player to corpse
	// remove player from cache
	log('trying to kill ' + player, VERBOSE);
	//if (!(player && io && io.clients && io.clients[player])) return;
	log('about to kill ' + player, VERBOSE);
	//io.clients[player].send('die', pos);
	client.del(player);
	client.del('geo_' + player);
	client.hdel(CLIENTS, player);
	log('killed ' + player, VERBOSE);
}

setInterval(updateState, 32);
setInterval(sendStateUpdate, 32);

// tell socket io to handle requests
io.on('connection', function (socket) {
    var player = socket.id;

    log('connected ' + player + ' on ' + Date.now(), INFO);

    // set up functions to listen to client	
    socket.on('disconnected', function (socket) {
        log('disconnected', INFO);
        socket.emit('message', 'disconnected');

        // remove the client from redis

		killPlayer(player);
    });

    // add point to redis
	var pos = [Math.random() * MAXX, Math.random() * MAXY];
    client.hsetAsync(CLIENTS, player, '1')
	.then(result => {
        log('set client ' + player, INFO);
        return result;
    })
	.catch(err => {
        log('err setting client ' + err, ERROR)
    })
	.then(result => {
        return client.hmsetAsync(player,
			CID, player,
            COLOR,   Math.floor(255 * Math.random()) + ','
                   + Math.floor(255 * Math.random()) + ','
                   + Math.floor(255 * Math.random()),
            ATAN, ((4 * Math.PI * Math.random()) - 2 * Math.PI).toString(),
            POS, pos.toString(),
			STATE, ALIVE,
			SIZE, 10
		);
    })
	.catch(err => {
        log('unable to set client hash ' + err, ERROR);
    })
	.then(result => {
        log('set multiple hashes', VERBOSE);
		// convert pos[0] [0,MAXX] TO [0, 90]
		// convert pos[1] [0,MAXY] TO [0, 85]
		var longitude = pos[0]/MAXX*90;
		var latitude = pos[1]/MAXY*85;
		return client.geoaddAsync('geo_' + player, longitude, latitude);
    });

    // client interactions
    // at -> new arctan sent by client 
    //       to be used in next move calculated by server
    // d  -> drop indicator set for next move calculation by server

    socket.on('at', newatan => {
        // push the new atan to redis
        log('received new atan ' + newatan + ' from player ' + player, VERBOSE);
        client.hsetAsync(player, 'atan', newatan);
    });
    socket.on('d', drop => {
        // set redis flag to drop a piece of body at current pos
        log('received new drop ' + player, VERBOSE);
        client.hsetAsync(player, 'drop', 1);
    });
});

// configure the server to handle requests
app.get('/*', function (req, res) {
	log(req.path, INFO);
	if (req.path == '/') {
		res.sendFile('index.html',
			{
				root: path.join(__dirname, './')
			}
		);
	} else if (req.path == '/bot') {
		res.sendFile('bot.html',
			{
				root: path.join(__dirname, './')
			}
		);
	} else {
	    res.send('<body><h1>What are you trying to do?  Nit the root.</h1></body>');
	}
});

// listen for requests
var PORT = 3000;
try {
    http.listen(PORT, function () {
        log('listening on *:' + PORT, INFO);
    });
} catch (x) {
    log('failed to listen. ' + x, INFO);
}
