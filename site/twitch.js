var Twitch = (function() {
    
    var twitchOAuth2Token = null;
    var tokenScopes = "user:read:follows"
    
    var clientId;
    var userID = null;
    
    var errorIndicator = "There was an error previously";
    
    // Track server calls/requests.
    var numTotalRequests = 0;
    var numCompletedRequests = 0;

    // Max number of streams to fetch
    // TODO: put this in settings
    var TWITCH_STREAM_LIMIT = 100;
    
    // Authentication functions
    
    function setOAuth2Token() {
        /*
        If we detect a OAuth2 URI mismatch error: set the Twitch OAuth2
         token to errorIndicator, and put up a notification.
        If the token is not there yet: redirect to get it.
        If the token is broken: set it to errorIndicator, and put up a
         notification.
        Otherwise: the token is good, so set it.
        
        Return true if we're redirecting, false otherwise.
        */
        
        clientId = Config.clientId;

        var urlSearchArgs = window.location.search.substr(1).split("&");
        if (urlSearchArgs.indexOf('error=redirect_mismatch') !== -1) {
            // OAuth failed because we didn't give the exact URI that
            // auth expects.
            //
            // This happens predictably when testing the following page with
            // python http.server, but how it happens in production is
            // unknown.
            // Until that is known, we can't attempt to autocorrect the URL.
            // So we'll just show an error message for now.
            
            Main.showNotification(
                "There was a URL-related problem with Twitch authentication."
                + " Try loading the page again from a link or bookmark."
            );
            twitchOAuth2Token = errorIndicator;
            return false;
        }
        
        // The urlFragment, if any, should be the OAuth2 token.
        // If we don't have the token yet, then get it.
        var urlFragment = window.location.hash;
        
        if (urlFragment === "") {
            // Go to Twitch Settings -> Connections and create a new
            // dev app there. Enter this page's URI where it asks you to.
            // Then put the Client ID in config.js, whose contents may look
            // like this for example:
            // Config = {
            //     clientId: "abc1def2ghi3jkl4mno5pqr6stu7vw"
            // };
            
            var redirectUri = window.location;
            
            var authUrl =
                'https://id.twitch.tv/oauth2/authorize?response_type=token&client_id='
                + clientId
                + '&redirect_uri='
                + redirectUri;
            
            // Permission scopes required by our API calls.
            authUrl += '&scope=' + encodeURIComponent(tokenScopes);
        
            // Redirect to the authentication URL.
            window.location = authUrl;
        
            return true;
        }
        
        // If we're here, we have a urlFragment, presumably the OAuth2 token.
        //
        // The fragment looks like "access_token=ab1cdef2ghi3jk4l"
        // or "access_token=ab1cdef2ghi3jk4l&scope=".
        // Parse out the actual token from the fragment.
        var fragmentRegex = /^#access_token=([a-z0-9]+)/;
        var regexResult = fragmentRegex.exec(urlFragment);
        
        if (regexResult === null) {
            // URL fragment found, but couldn't parse an access token from it.
            //
            // How to test: Type garbage after the #.
            Main.showNotification(
                "Couldn't find the Twitch authentication token."
                + " If there's a # in the URL, try removing the # and everything after it, then load the page again."
            );
            twitchOAuth2Token = errorIndicator;
            return false;
        }
        
        // Access token successfully grabbed.
        twitchOAuth2Token = regexResult[1];
        return false;
    }
    
    function onAuthFail() {
        Main.showNotification(
            "There was a problem with Twitch authentication. Possible fixes:"
            + " (1) If there's a # in the URL, try removing the # and everything after it, then load the page again."
            + " (2) Go to twitch.tv, log out, log in again, and then try loading this page again."
        );
    }
    
    function onAuthSuccess() {
        // Remove the fragment from the URL, for two reasons:
        // 1. If the fragment is still there and the user refreshes the page,
        //    and the auth token has expired, then the auth will fail. This
        //    will probably confuse users - "why does the auth occasionally
        //    just fail?"
        // 2. It's kinda ugly, and potentially confusing for users
        //    when they see it.
        //
        // The drawback is that a page refresh with a still-valid auth token
        // will no longer be particularly fast, but that's arguably
        // outweighed by the above two things.
        //
        // As for how to remove the fragment, without triggering a refresh:
        // https://stackoverflow.com/a/13824103/
        
        // First check if we already removed the fragment from a previous call.
        // If so, we're done.
        if (window.location.href.indexOf('#') === -1) {
            return;
        }
        
        // Remove the fragment as much as it can go without adding an entry
        // in browser history.
        window.location.replace("#");
        
        // Slice off the remaining '#' in HTML5.
        if (typeof window.history.replaceState == 'function') {
            history.replaceState({}, '', window.location.href.slice(0, -1));
        }
    }
    
    
    // Request counter functions
    
    function incTotalRequests() {
        numTotalRequests++;
        Main.updateRequestStatus(
            "Twitch", numTotalRequests, numCompletedRequests
        );
    }

    function incCompletedRequests() {
        numCompletedRequests++;
        Main.updateRequestStatus(
            "Twitch", numTotalRequests, numCompletedRequests
        );
    }
    
    function requestsAreDone() {
        return numTotalRequests === numCompletedRequests;
    }
    


    function ajaxRequest(url, params, callback) {
        incTotalRequests();
        
        var data = params;
        console.log(clientId);

        // Apparently Twitch does not support CORS:
        // https://github.com/justintv/Twitch-API/issues/133
        // So we must use JSONP.
        $.ajax({
            url: url,
            type: 'GET',
            headers: {
                "Client-Id": clientId,
                "Authorization": "Bearer " + twitchOAuth2Token
            },
            data: data,
            
            success: Util.curry(
                function(callback_, response){
                    callback_(response);
                    incCompletedRequests();
                },
                callback
            )
        });
    }
    
    function dateStrToObj(s) {
        // The Twitch API gives dates as strings like: 2015-08-03T21:05:57Z
        // This is a "simplification of the ISO 8601 Extended Format"
        // which new Date() can take. The "Z" denotes UTC.
        // https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Date
        // https://www.ecma-international.org/ecma-262/5.1/#sec-15.9.1.15
        return new Date(s);
    }
    
    
    
    function getUserID() {
        if (twitchOAuth2Token === errorIndicator) {
            setUserID(errorIndicator);
            return;
        }

        ajaxRequest('https://api.twitch.tv/helix/users', {}, setUserID);
    }

    function setUserID(userResponse) {
        if (userResponse === errorIndicator) {
            userID = errorIndicator;
            return;
        }

        onAuthSuccess();
        
        userID = userResponse.data[0].id;
        
        // This should be elsewhere, I guess?
        getStreams();
    }
        
    function getStreams() {
        if (twitchOAuth2Token === errorIndicator) {
            setStreams(errorIndicator);
            return;
        }

        ajaxRequest(
            'https://api.twitch.tv/helix/streams/followed',
            {'first': TWITCH_STREAM_LIMIT, "user_id": userID},
            setStreams
        );
    }
    
    function setStreams(streamsResponse) {
        var followedStreams;
        
        if (streamsResponse === errorIndicator) {
            followedStreams = [];
        }
        else if (streamsResponse.error && streamsResponse.error === "Unauthorized") {
            // Authentication failed.
            //
            // How to test: Type garbage after "access_token=". Or load in
            // Firefox, then load in Chrome, then load in Firefox again with
            // the same access token.
            onAuthFail();
            followedStreams = [];
        }
        else {
            onAuthSuccess();
            followedStreams = streamsResponse.data;
        }
        
        var twitchStreamDicts = [];
        
        var i;
        for (i = 0; i < followedStreams.length; i++) {
            
            var stream = followedStreams[i];
            
            var streamDict = {};
            
            streamDict.channelLink = 'https://www.twitch.tv/' + stream.user_login;
              
            streamDict.thumbnailUrl = stream.thumbnail_url.replace("{width}", "240").replace("{height}", "135");
            
            streamDict.streamTitle = stream.title
              || "(Failed to load title)";
            
            if (stream.game_id || stream.game_name) {
                streamDict.gameName = stream.game_name
                streamDict.gameLink = 'https://www.twitch.tv/directory/game/'
                    + stream.game_name;
                // If the image doesn't exist then it'll give us
                // ttv-static/404_boxart-138x190.jpg automatically
                // (without us having to specify that).
                streamDict.gameImage = "https://static-cdn.jtvnw.net/ttv-boxart/"
                    + stream.game_name + "-138x190.jpg";
            }
            else {
                streamDict.gameName = null;
            }
            
            streamDict.viewCount = stream.viewer_count;
            streamDict.channelName = stream.user_name;
            streamDict.startDate = dateStrToObj(stream.started_at);
            streamDict.site = 'Twitch';
            
            twitchStreamDicts.push(streamDict);
        }
        
        Main.addStreams(twitchStreamDicts);
    }
    
    
    // Public methods
    
    return {
    
        setOAuth2Token: function() {
            return setOAuth2Token();
        },
        startGettingMedia: function() {
            getUserID();
        },
        requestsAreDone: function() {
            return requestsAreDone();
        }
    }
})();
