'use strict';


// Wrap everything in an anonymous function to avoid polluting the global namespace
(function () {
  const STUB=false;

  /** The custom metadata key that will be used for the workbook input */
  const WORKBOOK_KEY = "workbook";

  // STORE HANDLING
  // ------------------------------------------------------------

  function getJSONSetting(key, defaultValue) {
    return JSON.parse(getSetting(key, JSON.stringify(defaultValue)));
  }

  function setJSONSetting(key, value) {
    return setSetting(key, JSON.stringify(value));
  }

  function getSetting(key, defaultValue) {
    if (STUB) {
      return window.localStorage.getItem(key) || defaultValue;
    } else {
      return tableau.extensions.settings.get(key) || defaultValue;
    }
  }

  function setSetting(key, value) {
    if (STUB) {
      return window.localStorage.setItem(key, value);
    } else {
      return tableau.extensions.settings.set(key, value);
    }
  }

  // CUSTOM METADATA FUNCTIONS
  // ------------------------------------------------------------


  const userMetadataKey = 'userMetadata';

  /** Returns the user metadata */
  function getUserMetadata() {
    return getJSONSetting(userMetadataKey, {});
  }

  /** Updates the user metadata with the new metadata */
  function setUserMetadata(newData) {
    return setJSONSetting(userMetadataKey, newData);
  }

  /**
   * map() function to unpack - transform - repack the metadata
   */
  function transformUserMetadata(fn) {
    setUserMetadata(fn(getUserMetadata()));
  }

  /** Removes a specific key from the user metadata */
  function removeUserMetadataKey(key) {
    transformUserMetadata(old => {
      delete old[key];
      return old;
    });
  }

  /** Removes a specific key from the user metadata */
  function updateUserMetadataKey(key, value) {
    transformUserMetadata(old => {
      old[key] = value;
      return old;
    });
  }


  /** Removes a specific key from the user metadata */
  function renameUserMetadataKey(key, newKey) {
    transformUserMetadata(meta => {
      meta[newKey] = meta[key];
      delete meta[key];
      return meta;
    });
  }

  /** Adds a new metadata key/value pair with a unique name */
  function addUserNewMetadataPair() {

    // Attempts to find the next empty "Key #" string
    function findNextFreeKey(meta) {
      let i = 1;
      let key = "Key " + i;

      while(typeof meta[key] !== 'undefined') {
        i++;
        key = "Key " + i;
      }
      return key;
    }


    transformUserMetadata(meta => {
      let nextKey = findNextFreeKey(meta);
      meta[nextKey] = "";
      return meta;
    });

  }

  /** Attempts to set the WORKBOOK_KEY key of the metadata to an empty string if not present */
  function initializeWorkbookName() {
    transformUserMetadata(meta =>{
      if (typeof meta[WORKBOOK_KEY] === 'undefined') {
        meta[WORKBOOK_KEY] = "";
      }

      return meta;
    });
  }

  /** Change the workbook name when changing the workbook name input field */
  function addWorkbookNameChanngeHandler() {
    let $input = $('#workbookName');
    $input.on('change', function(e) {
      transformUserMetadata(meta => {
        meta[WORKBOOK_KEY] = $input.val() || meta[WORKBOOK_KEY];
        return meta;
      });
    });
  }

  /** Update the displayed settings table and the deployment ID */
  function updateSettings() {
    let userMeta = getUserMetadata();
    let fields = Object.keys(userMeta)
        .filter(k => k !== WORKBOOK_KEY)
        .map(k => userMetaKeyValuePairView(k, userMeta[k]));

    // Set the table values
    $('#settings-table-body').html(fields.join(''));

    $('#deploymentId').val( getSetting('deploymentId', null) );
    // set the workbook name value
    $('#workbookName').val(userMeta[WORKBOOK_KEY]);
  }


  /**
   * Generates the template for a single key-value pair in the custom metadata field list
   */
  function userMetaKeyValuePairView(key, value) {
    let k = _.escape(key);
    let v = _.escape(value);
    let inputId = "user-meta-value" + k;
    let keyInputId = "user-meta-key" + k;

    return `<tr class="custom-metadata">
          <td>
            <input class="form__control form-field__control user-meta-key" type="text" id="${keyInputId}" value="${k}" data-key="${k}">
          </td>

          <td>
            <input class="form__control form-field__control user-meta-value" type="text" id="${inputId}" placeholder="${k} Value" value="${v}" data-key="${k}">
          </td>

          <td>
            <a href="#" class="link link--collapse delete-key-button" data-key="${k}">DELETE</a>
          </td>

        </tr>`;
  }

  /**
   * Registers the key/value pair deletition handler for the delete buttons
   */
  function addDeleteHandler() {
    // $('#settings-table').on('click', '.delete-key-button', function(e){
    $('#settings-table').on('click', '.delete-key-button', function(e){
      let $this = $(this);
      let key = $this.data('key');
      if (!key) {
        throw new Error("No 'data-key' attribute on the delete button");
      }

      removeUserMetadataKey(key);
      updateSettings();

    });
  }

  /**
   * Handles colour change for the given class of inputs in the settings table
   */
  function addOnChangeColorHandler(klass) {
    $('#settings-table').on('input', klass, function(e){
      let $this = $(this);
      $this.addClass('has-change');
    });

  }

  /** Handles changing of the value for a key-value pair */
  function addKeyChangeHandler() {
    const Klass = '.user-meta-key';
    addOnChangeColorHandler(Klass);

    $('#settings-table').on('change', Klass, function(e){
      let $this = $(this);
      let key = $this.data('key');
      let newKey = $this.val();

      renameUserMetadataKey(key, newKey);
      updateSettings();
    });
  }



  /** Handles changing of the value for a key-value pair */
  function addValueChangeHandler() {
    const Klass = '.user-meta-value';
    addOnChangeColorHandler(Klass);

    $('#settings-table').on('change', Klass, function(e){
      let $this = $(this);
      let key = $this.data('key');
      let val = $this.val();

      updateUserMetadataKey(key, val);
      updateSettings();
    });
  }

  /** Handles changing of the value for a key-value pair */
  function addDeploymentIdChangeHandler() {
    $('#deploymentId').on('change', function(e){
      let $this = $(this);
      let val = $this.val();
      setSetting('deploymentId', val);

      updateSettings();
    });
  }


  /** Handles clicking on the Add New Metadata Pair button */
  function addNewPairHandler() {
    $('#add-custom-metadata').click(function(e){
      addUserNewMetadataPair();
      updateSettings();
    });
  }

  function validateDeploymentID(deploymentId) {
    $.ajax({
      url: "/api/1.0/events/validate",
      type: "POST",
      data: JSON.stringify({"deploymentId": deploymentId}),
      contentType:"application/json",
      success:function (){
        closeDialog()
      },
      error: function(err){
        var deploymentIdValidation = $('#deploymentId-validation');
        showError(deploymentIdValidation, "Invalid deployment id. Please try again or get a new one below.");
        console.log(err);
      }
    });
  }

  function validateWorkbook(workbookName) {
    if (workbookName.length === 0){
      return false;
    }
    return true;
  }

  function showError(validationHTMLElement, errorMessage) {
    validationHTMLElement.html(errorMessage);
    validationHTMLElement.show();
  }

  function hideError(validationHTMLElement) {
    validationHTMLElement.html("");
    validationHTMLElement.hide();
  }


  /**
   * Initializes the UI elements of the configure dialog
   */
  function init() {
    $('#closeButton').click(function (){
      var workbookValidation = $('#workbook-validation');
      if (!validateWorkbook($('#workbookName').val())){
        $('#deploymentId-validation').hide();
        showError(workbookValidation, "Missing workbook name. Please provide workbook name.");
      } else {
        hideError(workbookValidation)
        validateDeploymentID($('#deploymentId').val());
      }
    });

    // WORKBOOK NAME fields
    initializeWorkbookName();
    addWorkbookNameChanngeHandler();

    // REST OF THE FIELDS
    updateSettings();
    addDeploymentIdChangeHandler();

    addDeleteHandler();
    addKeyChangeHandler();
    addValueChangeHandler();
    addNewPairHandler();


    $(".collapsable").click(function () {

      var header = $(this);
      //getting the next element
      var content = header.next(".collapse-content");

      //open up the content needed - toggle the slide- if visible, slide up, if not slidedown.
      content.slideToggle(300, function () {
        //execute this after slideToggle is done
        //change text of header based on visibility of content div
        $('.collapsable .toggle-icon').toggleClass('fa-angle-down');
        $('.collapsable .toggle-icon').toggleClass('fa-angle-up');
      });
    });
  }


  /**
   * This extension collects the IDs of each datasource the user is interested in
   * and stores this information in settings when the popup is closed.
   */
  const datasourcesSettingsKey = 'selectedDatasources';
  let selectedDatasources = [];

  $(document).ready(function () {

    if (STUB) {
      init();
    } else {

      tableau.extensions.initializeDialogAsync()
          .then(function (openPayload) {
            console.log("[EEE] Configure loaded");
            init();
          });
    }
  });

  /**
   * Stores the selected datasource IDs in the extension settings,
   * closes the dialog, and sends a payload back to the parent.
   */
  function closeDialog() {
    // let currentSettings = tableau.extensions.settings.getAll();
    // tableau.extensions.settings.set(datasourcesSettingsKey, JSON.stringify(selectedDatasources));

    tableau.extensions.settings.saveAsync().then((newSavedSettings) => {
      tableau.extensions.ui.closeDialog("true");
    });
  }



})();
