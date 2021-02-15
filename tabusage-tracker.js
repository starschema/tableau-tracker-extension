'use strict';

// Wrap everything in an anonymous function to avoid polluting the global namespace
(function () {

  console.log("Window.size = " + JSON.stringify(window.outerWidth) );

  var KIND_NOOP = "NOOP";
  var KIND_FILTER_CHANGE = "FILTER_CHANGE";
  var KIND_FILTER_STATE = "FILTER_STATE";
  var KIND_SELECTION_CHANGE = "SELECTION_CHANGE";

  const DEPLOYMENT_ID_KEY = "deploymentId";

  function getMetaTagContentByName(name){
    var targetUrlTag = $('head meta[name="' + name + '"]');
    return targetUrlTag ? $(targetUrlTag).attr('content') : null;
  }

  function getTargetUrl() {
    function getQueryParamByName(name){
        var regex = new RegExp('[?&]' + name + '(=([^&#]*)|&|#|$)'),
            results = regex.exec(window.location.search);
        if (!results) return null;
        if (!results[2]) return '';
        return decodeURIComponent(results[2].replace(/\+/g, ' '));
    }

    var targetUrl = getQueryParamByName('backendUrl');
    targetUrl = targetUrl ? targetUrl : "/api/1.0/events";

    console.log("Using target:", targetUrl);
    return targetUrl;
  }

  function sendToLambda(what) {
    var URL = TARGET_URL + "/tableau-events";

    console.log("[LLL] Sending to lambda " + JSON.stringify(what));

    $.ajax({
      type: "POST",
      url: URL,
      data: JSON.stringify(what),
      contentType: "application/json; charset=utf-8",
      success: function(data){
        console.log("Event saved successfully!");
      },
      error: function(xhr, textStatus, err) {
        console.log("[ERRR] " + textStatus + "  " + err);
        updateStatus(true);
      }
    });
  }


  // This returns a string representation of the values a filter is set to.
  // Depending on the type of filter, this string will take a different form.
  function getFilterValues (filter) {

    switch (filter.filterType) {
      case 'categorical':
        return {
          filterType: filter.filterType,
          appliedValues: filter.appliedValues
        };
      case 'range':
        return {
          filterType: filter.filterType,
          minValue: filter.minValue,
          maxValue: filter.maxValue,
        }
      case 'relative-date':
        return {
          filterType: filter.filterType,
          periodType: filter.periodType,
          rangeN: filter.rangeN,
          rangeType: filter.rangeType,
        };
      default:
        return {
          filterType: filter.filterType,
        };
    }
  }



  // Sends the filter state of all worksheets of the current dashboard
  function sendFilterState(builder) {
    const dashboard = tableau.extensions.dashboardContent.dashboard;

    let filters = dashboard.worksheets.map(function(worksheet) {
      return worksheet.getFiltersAsync();
    });

    function collectFilterData(filtersForWorksheet) {
      return filtersForWorksheet.map(function (filter) {
        return Object.assign({}, {
          fieldName: filter.fieldName,
          worksheetName: filter.worksheetName,
        }, getFilterValues(filter));
      });
    }

    console.log("[FFF] START Sending filter state");

    return Promise.all(filters)
      .then(allFilters => allFilters.map(collectFilterData))
      .then(function(data) {
        console.log("[FFF] COLLECTED filter state");
        return dispatchEvent(builder, KIND_FILTER_STATE, {
          filterState: data
        });
      })
  }


  let shouldSendFilterState = _.debounce(sendFilterState, 5000)

  function startHeartbeatLoop(pulseTime, builder) {
    function sendHeartBeat() {
      dispatchEvent(builder, KIND_NOOP, {});
    }
    setInterval(sendHeartBeat, pulseTime);
  }


  // THE LAMBDA TO TARGET
  // --------------------
  //
  var TARGET_URL = getTargetUrl();

  $(document).ready(function () {
    tableau.extensions.initializeAsync({'configure': configure}).then(function () {

      // var DEPLOYMENT_ID_KEY = "deploymentId";
      // Fetch and update the deployment id.
      // TODO: provide UI for this
      // var deploymentId = getParameterByName("deploymentId") || tableau.extensions.settings.get(DEPLOYMENT_ID_KEY) || "TEST-DEPLOYMENT-ID";
      let deploymentId = tableau.extensions.settings.get(DEPLOYMENT_ID_KEY, null);

      // Generate a session id for the source
      let dashboard = tableau.extensions.dashboardContent.dashboard;
      let sourceId = randomString(6,4);
      let projectName = "Default";
      let dashboardName = dashboard.name;


      let builder = init(deploymentId, sourceId, dashboardName, projectName);

      updateStatus();

      registerFilterChangeHandlers(builder);

      startHeartbeatLoop(15000, builder);
      // First, check for any saved settings and populate our UI based on them.
      // buildSettingsTable(tableau.extensions.settings.getAll());
    }, function (err) {
      // Something went wrong in initialization
      console.log('Error while Initializing: ' + err.toString());
    });

    $("#configureButton").on('click', function() {
      configure();
    });

  });

  // storage for handler deregistration functions
  var unregisterHandlerFunctions = [];

  // FILTER CHANGE EVENTS
  //
  function registerFilterChangeHandlers(builder) {

    // unregister all handlers
    unregisterHandlerFunctions.forEach(function (unregisterHandlerFunction) {
      unregisterHandlerFunction();
    });


    // To get filter info, first get the dashboard.
    var dashboard = tableau.extensions.dashboardContent.dashboard;

    // Then loop through each worksheet and get its filters, save promise for later.
    dashboard.worksheets.forEach(function (worksheet) {

      console.log("[XXX] Registering handlers for sheet");
      unregisterHandlerFunctions.push(
        worksheet.addEventListener(tableau.TableauEventType.FilterChanged, function(e) {
          onFilterChange(builder, e);
        }),
        worksheet.addEventListener(tableau.TableauEventType.MarkSelectionChanged, function(e){
          onMarksSelectionChange(builder, e);
        })
      );
    });
  }

  function onFilterChange(builder, e) {

    function makeEventData(filterData) {
      return Object.assign({
        fieldName: e.fieldName,
        sheet: e.sheet.name,
      }, filterData);
    }



    return e.getFilterAsync()
      .then(getFilterValues)
      .then(makeEventData)
      .then(function(e) {
        // call the debounced filter state sender
        // to trigger a call after FILTER_STATE_TIMEOUT
        shouldSendFilterState(builder);

        return dispatchEvent(builder, KIND_FILTER_CHANGE, e);
      })
  }

  function dispatchEvent(builder, kind, eventData) {
    console.log("[ZZZ] dispatchEvent" + kind + " data: " + JSON.stringify(eventData));
    var evt = addTableauSettings( addScreenSize( addLocationData(eventData)));
    var packed = builder(kind, evt);

    return sendToLambda({ events : [ packed ] });
  }


  function addScreenSize(eventData) {
    return Object.assign({}, eventData, {
      window: {
        width: window.outerWidth,
        height: window.outerHeight,
      }
    });
  }

  function addLocationData(eventData) {
    return Object.assign({}, eventData, {
      document: {
        location: window.document.location.href,
        // Another AWS nugget:
        // sending an empty string results in 'An AttributeValue may not contain an empty string'
        // error...
        referer: document.referrer || "NULL"
      }
    });
  }

  /**
   * Appends any Tableau extension settings to the posted event for passing
   * user-configurable metadata along
   */
  function addTableauSettings(eventData) {
    return Object.assign({}, eventData, {
      settings: tableau.extensions.settings.getAll()
    });
  }



  /**
   * Generates a random string of letter groups. These may fool the untrained
   * observer into thinking that these are UUIDs
   */
  function randomString(groupCount, groupLen) {
    let o = [];
    for (let i = 0; i < groupCount; ++i) {
      let group = [];
      for (let j = 0; j < groupLen; ++j) {
        group.push(Math.round(Math.random() * 32).toString(32));
      }
      o.push(group.join(''));
    }

    return o.join('-');
  }



  function init(deploymentId, sourceId, dashboardName, projectName) {

    var Kinds = {
      NOOP: KIND_NOOP,
      FILTER_CHANGE: KIND_FILTER_CHANGE,
      SELECTION_CHANGE: KIND_SELECTION_CHANGE,
      FILTER_STATE: KIND_FILTER_STATE,
    };


    // Validator for string attributes
    function mustHaveStringAttributes(evt, attrs) {
      attrs.forEach(function(a) {
        let v = evt[a];
        if (typeof v !== 'string' || v.length === 0) {
          throw new Error("Missing attribute: `" + a + "`");
        }
      });
    }

    function mustBeArray(v) {
      if (!Array.isArray(v)) {
        throw new Error('Expected an Array as request body root.');
      }
      return v;
    }


    /**
     * Throws an error if the event is invalid. Returns the event if valid.
     */
    function mustBeAValidEvent(evt) {

      try {
        mustHaveStringAttributes(evt, [
          'deploymentId',
          'sourceId',
          'sourceSequenceId',
          'recordedAt',
          'projectName',
          'dashboardName',
          'workbookName',
          'kind'
        ]);
      } catch (e) {
        throw new Error("While validating: " + JSON.stringify(evt) + ": " + e.message  );
      }

      return evt;
    }

    /** Returns true if the kind of event provided is a valid one */
    function isValidEventKind(evtKind) {
      return (typeof Kinds[evtKind] !== 'undefined');
    }

    /**
     * Creates a new event
     */
    function makeEvent(deploymentId, sourceId, sourceSequenceId, workbookName, dashboardName, projectName, eventKind, eventData) {
      if (!isValidEventKind(eventKind)) {
        throw new Error(`Not a valid event kind: ${eventKind}`);
      }
      let recordedAt = new Date().toISOString();
      projectName = ((typeof projectName === 'string' && projectName.length > 0) ? projectName : "Default" );
      return {
        deploymentId,
        sourceId,
        sourceSequenceId: sourceSequenceId.toString(),
        recordedAt,

        workbookName: workbookName,
        dashboardName: dashboardName,
        projectName,

        kind: eventKind,
        data: eventData,

      }
    }

    /**
     * Creates an event builder that creates events bound to the specific
     * deployment / project / dashboard / session
     */
    function makeEventBuilder(deploymentId, sourceId, dashboardName, projectName) {
      let sourceSequenceId = 0;
      return function(eventKind, eventData) {
        let deploymentId = tableau.extensions.settings.get(DEPLOYMENT_ID_KEY);
        let workbookName = getWorkbookName();
        return makeEvent(deploymentId, sourceId, ++sourceSequenceId, workbookName, dashboardName, projectName, eventKind, eventData);
      };
    }


    return makeEventBuilder(deploymentId, sourceId, dashboardName, projectName);
  }

  function getWorkbookName() {
    return JSON.parse(tableau.extensions.settings.get("userMetadata") || "{}")["workbook"];
  }

  /**
   * Updates the deployment ID and status displays from the settings */
  function updateStatus(errorOccured) {
    // show the deployment id
    let deploymentId = tableau.extensions.settings.get(DEPLOYMENT_ID_KEY);
    let workbookName = getWorkbookName();

    console.log("UPDATESTATUS() -- " + deploymentId + " " + workbookName);

    $('#deployment-id-readout').text(deploymentId);

    let statusText = "Running"
    $('#statusCircle').removeClass('orange red');
    $('#statusCircle').addClass('green');
    $('#configureButton').addClass('hidden');

    if (!deploymentId || !workbookName || errorOccured) {
      statusText = "Action required!"
      $('#statusCircle').removeClass('green red');
      $('#statusCircle').addClass('orange');
      $('#configureButton').removeClass('hidden');
    }
    // $('#extension-status').html(status);
    $('#statusText').html(statusText);
  }


  /** Shows the configuration dialog */
  function configure(url) {
    url = url ? url : config.base_url
    let popupUrl = url + getMetaTagContentByName("config-page");

    const popupOpts = {
      height: 650,
      width: 630,
    };

    /**
     * This is the API call that actually displays the popup extension to the user.  The
     * popup is always a modal dialog.  The only required parameter is the URL of the popup,
     * which must be the same domain, port, and scheme as the parent extension.
     *
     * The developer can optionally control the initial size of the extension by passing in
     * an object with height and width properties.  The developer can also pass a string as the
     * 'initial' payload to the popup extension.  This payload is made available immediately to
     * the popup extension.  In this example, the value '5' is passed, which will serve as the
     * default interval of refresh.
     */

    tableau.extensions.ui.displayDialogAsync(popupUrl, "", popupOpts).then((closePayload) => {
      // The promise is resolved when the dialog has been expectedly closed, meaning that
      // the popup extension has called tableau.extensions.ui.closeDialog.
      // $('#inactive').hide();
      // $('#active').show();
      updateStatus();


    }).catch((error) => {
      // One expected error condition is when the popup is closed by the user (meaning the user
      // clicks the 'X' in the top right of the dialog).  This can be checked for like so:
      switch(error.errorCode) {
        case tableau.ErrorCodes.DialogClosedByUser:
          console.log("Dialog was closed by user");
          break;
        case tableau.ErrorCodes.InvalidDomainDialog:
          console.log("Invalid domain!");
          if (config.base_url === url) {
            console.log("Trying with the old url...");
            configure(config.old_url);
          }
          break;
        default:
          console.error(error.message);
      }
    });

  }



})();
