let config = {
    socketUrl: 'wss://socket.map.tantrisse.ovh',
    debug: false,
    //reconnectTime: 5000,
    //defaultChecked: true,
    //addPopup: true
};

function PlayerLocations(config) {
    this.socketUrl = config.socketUrl || ((window.location.protocol === 'https:' ? 'wss://' : 'ws://') + window.location.hostname + ':8888');
    this.debug = config.debug || false;
    this.reconnectTime = config.reconnectTime || 5000;
    this.defaultChecked = config.defaultChecked || true;
    this.addPopup = config.addPopup || true;

    this._baseWorldName = 'Licorne Land';
    this._connection = null;
    this._visibleMarkers = {};
    this._list = {};
    this._layerGroup = null;
    this._ctrl = null;
    this._onLayerAdd = this.onLayerAdd.bind(this);
    this._currentWorld = null;

    this._playersonlinelist = document.querySelector("#playersonlinelist");
    this._playersonlinetot = document.querySelector("#playersonlinetot");

    overviewer.util.ready(this.reinitialize.bind(this));
    console.info('Player locations plugin for Overviewer loaded');
}

PlayerLocations.prototype.reinitialize = function () {
    if (this._connection === null)
        this.connect(); // first connect

    if (this._ctrl) {
        // remove old and reset
        this._ctrl.remove();
        this._visibleMarkers = {};
        this._layerGroup = null;
        this._ctrl = null;
        window.overviewer.map.off('baselayerchange', this._onLayerAdd);
    }

    // add new
    this._layerGroup = L.layerGroup();
    this._ctrl = L.control.layers([], {'Players': this._layerGroup}, {collapsed: false}).addTo(window.overviewer.map);
    if (this.defaultChecked) {
        this._layerGroup.addTo(window.overviewer.map);
    }

    this._currentWorld = window.overviewer.current_world;
    window.overviewer.map.on('baselayerchange', this._onLayerAdd);
    if (this.debug) {
        console.info('Player locations plugin for Overviewer initialized');
    }
    if (Object.keys(this._list).length > 0) {
        this.updatePlayerMarkers(this._list); // add markers
    }
};

PlayerLocations.prototype.updatePlayerMarkers = function (newList, worldChanged) {
    const newKeys = Object.keys(newList);
    const oldKeys = Object.keys(this._visibleMarkers);
    worldChanged = worldChanged || false;
    const currentDimension = this.getCurrentDimension();

    // remove old players and update existing
    oldKeys.forEach((player) => {
        // world changed, player left, player changed dimensions
        if (worldChanged || !newKeys.includes(player) || newList[player].dimension !== currentDimension) {
            this._layerGroup.clearLayers();
            delete this._visibleMarkers[player];
        } else
            this._visibleMarkers[player].setLatLng(this.getLatLngForPlayer(newList[player]));
    });

    // add new markers for new players
    newKeys.forEach((player) => {
        // world changed, player joined, player changed dimension
        if ((worldChanged || !oldKeys.includes(player)) && newList[player].dimension === currentDimension) {
            const icon = L.icon({
                iconUrl: 'https://overviewer.org/avatar/' + encodeURIComponent(player),
                iconSize: [16, 32],
                iconAnchor: [20, 30],
                popupAnchor: [-13, -29]
            });

            const marker = L.marker(this.getLatLngForPlayer(newList[player]), {
                icon: icon,
                riseOnHover: true
            });

            marker.on('mouseover', () => marker.openPopup());
            marker.on('mouseout', () => marker.closePopup());

            if (this.addPopup)
                marker.bindPopup(player);

            marker.addTo(this._layerGroup);

            this._visibleMarkers[player] = marker;
        }
    });

    this._list = newList;

    this.updatePlayerList();

    if (this.debug) {
        console.info('Player markers updated', worldChanged, currentDimension, this._list, this._currentWorld);
    }
};

PlayerLocations.prototype.updatePlayerList = function () {
    //show total players online
    this._playersonlinetot.innerHTML = Object.keys(this._list).length.toString();

    //loop all incoming players and add ul-list for worlds, and li-elements for players
    for (const [playerName, playerData] of Object.entries(this._list)) {
        const worldSelector = this.getWorldNameFromDimension(playerData.dimension.split(":")[1]);
        const ulWorld = this.getOrCreateWorldListElement(worldSelector.replace(' ', '_'), this._playersonlinelist, "ul");

        const playerSelector = "player_" + playerName;
        const liPlayer = this._playersonlinelist.querySelector("#" + playerSelector);
        if (liPlayer === null) {
            //player does not exist in any worldlists, add
            const newLI = document.createElement("li");
            newLI.setAttribute("id", playerSelector);
            newLI.innerText = playerName;
            newLI.setAttribute("style", "user-select: none;");
            newLI.dataset.playername = playerName;
            newLI.addEventListener('click', (e) => this.centerOnPlayer(e.target.dataset.playername, true));

            ulWorld.appendChild(newLI);
        } else if (liPlayer.parentElement.id !== ulWorld.id) {
            const parent = liPlayer.parentElement;
            parent.removeChild(liPlayer);

            if (parent.childElementCount === 0) {
                //world got empty after move, delete list
                parent.remove();
            }

            ulWorld.appendChild(liPlayer);
        }
    }

    //clean up players who have disconnected
    const addedLiPlayers = this._playersonlinelist.querySelectorAll("li");

    addedLiPlayers.forEach(liPlayer => {
        if (!this._list[liPlayer.dataset.playername]) {
            const oldUlWorld = liPlayer.parentElement;
            liPlayer.remove();

            if (oldUlWorld.childElementCount === 0) {
                //world got empty after move, delete list
                oldUlWorld.remove();
            }
        }
    });
};

PlayerLocations.prototype.centerOnPlayer = function (playername, zoom = false, duration = 1) {
    if (Object.keys(this._list).length <= 0) {
        return;
    }
    const player = this._list[playername];

    if (player === undefined) {
        return;
    }
    const playerWorld = this.getWorldNameFromDimension(player.dimension);
    if (playerWorld !== overviewer.current_world) {
        if (!Object.keys(overviewer.collections.mapTypes).includes(playerWorld)) {
            //player's new world doesn't exist in overviewer-worlds
            return;
        }
        overviewer.worldCtrl.select.value = playerWorld;
        overviewer.worldCtrl.select.dispatchEvent(new Event('change'));
        zoom = true;
    }

    const latlng = overviewer.util.fromWorldToLatLng(
        player.x, player.y, player.z, overviewer.current_layer[overviewer.current_world].tileSetConfig
    );

    const zoomLevel = zoom ? overviewer.map.getMaxZoom() - 2 : overviewer.map.getZoom();

    overviewer.map.setView(latlng, zoomLevel, {
        "animate": true,
        "pan": {"duration": duration}
    });
}

PlayerLocations.prototype.getOrCreateWorldListElement = function (id, parent, type) {
    const selector = parent.querySelector("#" + id);
    if (selector === null) {
        const newUL = document.createElement(type);
        newUL.setAttribute("id", id);
        newUL.setAttribute("data-header", id.replace("_", " "));
        parent.appendChild(newUL);
        return newUL;
    } else {
        return selector;
    }
}

PlayerLocations.prototype.getLatLngForPlayer = function (playerData) {
    return window.overviewer.util.fromWorldToLatLng(playerData.x, playerData.y, playerData.z, this.getCurrentTileSet());
};

PlayerLocations.prototype.getWorldNameFromDimension = function (dimension) {
    // NOTE: this doesn't work for multi world setups or more than these 3 dimensions
    if (dimension.endsWith('nether')) {
        return this._baseWorldName + ' - nether';
    }
    if (dimension.endsWith('end')) {
        return this._baseWorldName + ' - end';
    }
    return this._baseWorldName;
}

PlayerLocations.prototype.getCurrentDimension = function () {
    // NOTE: this doesn't work for multi world setups or more than these 3 dimensions
    const world = window.overviewer.current_world;
    if (world.endsWith('nether')) {
        return 'minecraft:the_nether';
    }
    if (world.endsWith('end')) {
        return 'minecraft:the_end';
    }
    return 'minecraft:overworld'; // default
}

PlayerLocations.prototype.getCurrentTileSet = function () {
    return window.overviewer.current_layer[window.overviewer.current_world].tileSetConfig;
};

PlayerLocations.prototype.onLayerAdd = function (layerEvent) {
    // TODO add special event to overviewer itself, this is bad
    try {
        if (this.debug) {
            console.info('onLayerAdd', this._currentWorld, window.overviewer.current_world);
        }
        if (this._currentWorld !== window.overviewer.current_world) {
            // switched dimension
            this._currentWorld = window.overviewer.current_world;
            this._ctrl.remove();
            this._ctrl.addTo(window.overviewer.map); // readd menu -> move to bottom
            this.updatePlayerMarkers(this._list, true); // world changed
        }
    } catch (error) {
        if (this.debug) {
            console.error('onLayerAdd', error, layerEvent);
        }
    }
};

PlayerLocations.prototype.connect = function () {
    const ws = new WebSocket(this.socketUrl);
    this._connection = ws;
    if (this.debug) {
        ws.onopen = () => {
            console.info('WebSocket connection opened');
        };
    }
    ws.onerror = (error) => {
        if (error.message != null)
            console.error(`WebSocket error: ${error.message}`);
        else
            console.error(`WebSocket error`);
        if (this.debug) {
            console.error(error);
        }
    };
    ws.onmessage = (msg) => {
        try {
            let data = JSON.parse(msg.data);
            if (this.debug) {
                console.info('WebSocket received data', data);
            }
            this.updatePlayerMarkers(data);
        } catch (error) {
            console.error(`Error parsing WebSocket message: ${error.message}`);
            if (this.debug) {
                console.error(error);
            }
        }
    };
    ws.onclose = () => {
        if (this.debug) {
            console.info('WebSocket Connection closed');
        }
        this.updatePlayerMarkers({}); // remove markers
        setTimeout(this.connect.bind(this), this.reconnectTime);
    };
};

// initialize
window.PlayerLocations = new PlayerLocations(config);
