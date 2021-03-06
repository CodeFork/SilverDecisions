import * as d3 from './d3'
import {i18n} from './i18n/i18n'
import {Utils, log} from 'sd-utils'
import {AppUtils} from './app-utils'
import * as model from 'sd-model'

import {TreeDesigner, TreeDesignerConfig} from './tree-designer/tree-designer'
import {Templates} from './templates'
import {Sidebar} from './sidebar'
import {Toolbar} from './toolbar'
import {SettingsDialog} from './settings-dialog'
import {AboutDialog} from "./about-dialog";
import {Exporter} from "./exporter";
import {DefinitionsDialog} from "./definitions-dialog";
import {ComputationsManager} from "sd-computations";
import {SensitivityAnalysisDialog} from "./sensitivity-analysis-dialog";
import {LoadingIndicator} from "./loading-indicator";


var buildConfig = require('../tmp/build-config.js');

export class AppConfig {
    readOnly = false;
    logLevel = 'warn';
    workerUrl = null;
    jobRepositoryType = 'idb';
    clearRepository = false;
    buttons = {
        new: true,
        save: true,
        open: true,
        exportToPng: true,
        exportToSvg: true,
        exportToPdf: true
    };
    exports = {
        show: true,
        serverUrl: 'http://export.highcharts.com', //url of the export server
        pdf: {
            mode: 'server', // available options: 'client', 'server', 'fallback',
        },
        png: {
            mode: 'fallback', // available options: 'client', 'server', 'fallback',
        }
    };
    showDetails = true;
    showDefinitions = true;
    jsonFileDownload = true;
    width = undefined;
    height = undefined;
    rule = "expected-value-maximization";
    lng = 'en';
    format = {// NumberFormat  options
        locales: 'en',
        payoff: {
            style: 'currency',
            currency: 'USD',
            currencyDisplay: 'symbol',
            minimumFractionDigits: 0,
            maximumFractionDigits: 2,
            // minimumSignificantDigits: 1,
            useGrouping: true
        },
        probability: { // NumberFormat  options
            style: 'decimal',
            minimumFractionDigits: 2,
            maximumFractionDigits: 3,
            useGrouping: true
        }
    };
    title = '';
    description = '';
    treeDesigner = {};

    //https://github.com/d3/d3-format/blob/master/README.md#format

    constructor(custom) {
        if (custom) {
            Utils.deepExtend(this, custom);
        }
    }
}

export class App {
    static version = ''; // version is set from package.json
    static buildTimestamp = buildConfig.buildTimestamp;
    static utils = Utils;
    static appUtils = AppUtils;
    static d3 = d3;

    config;
    container;
    dataModel; //Data model manager
    expressionEngine;
    computationsManager;
    treeDesigner;
    toolbar;
    sidebar;

    constructor(containerIdOrElem, config, diagramData) {
        var p = Promise.resolve();
        this.setConfig(config);
        this.initI18n();
        this.initContainer(containerIdOrElem);
        this.initDataModel();
        p = this.initComputationsManager();
        this.initProbabilityNumberFormat();
        this.initPayoffNumberFormat();
        this.initTreeDesigner();
        this.initSidebar();
        this.initSettingsDialog();
        this.initAboutDialog();
        this.initDefinitionsDialog();
        this.initSensitivityAnalysisDialog();
        this.initOnBeforeUnload();
        this.initKeyCodes();
        p.then(()=>{
            this.initToolbar();
            if (diagramData) {
                this.openDiagram(diagramData);
            }else{
                this.updateView();
            }
        }).catch(e=>{
            log.error(e);
        });
    }

    setConfig(config) {
        if (!config) {
            this.config = new AppConfig();
        } else {
            this.config = new AppConfig(config);
        }
        this.setLogLevel(this.config.logLevel);
        return this;
    }

    static growl(){
        return AppUtils.growl(arguments)
    }

    setLogLevel(level){
        log.setLevel(level)
    }

    initContainer(containerIdOrElem) {

        if (Utils.isString(containerIdOrElem)) {
            var selector = containerIdOrElem.trim();

            if (!Utils.startsWith(selector, '#') && !Utils.startsWith(selector, '.')) {
                selector = '#' + selector;
            }
            this.container = d3.select(selector);
        } else {
            this.container = d3.select(containerIdOrElem);
        }
        var self = this;
        this.container.html(Templates.get('main', {version: App.version, buildTimestamp: App.buildTimestamp, 'lng': self.config.lng}));
        this.container.select('#silver-decisions').classed('sd-read-only', this.config.readOnly);
    }

    initI18n() {
        i18n.init(this.config.lng);
    }

    initDataModel() {
        var self = this;
        this.dataModel = new model.DataModel();
        // this.dataModel.nodeAddedCallback = this.dataModel.nodeRemovedCallback = ()=>self.onNodeAddedOrRemoved();
        this.dataModel.nodeAddedCallback = this.dataModel.nodeRemovedCallback = (node)=> Utils.waitForFinalEvent(()=>this.onNodeAddedOrRemoved(), 'onNodeAddedOrRemoved', 5);

        this.dataModel.textAddedCallback = (text)=> Utils.waitForFinalEvent(()=>this.onTextAdded(text), 'onTextAdded');
        this.dataModel.textRemovedCallback = (text)=> Utils.waitForFinalEvent(()=>this.onTextRemoved(text), 'onTextAdded');
    }

    initComputationsManager() {
        this.computationsManager = new ComputationsManager({
            ruleName: this.config.ruleName,
            worker:{
                url: this.config.workerUrl,
            },
            jobRepositoryType: this.config.jobRepositoryType,
            clearRepository: this.config.clearRepository
        }, this.dataModel);
        this.expressionEngine =  this.computationsManager.expressionEngine;
        return this.checkValidityAndRecomputeObjective(false, false, false);

    }

    initSidebar() {
        this.sidebar = new Sidebar(this.container.select('#sd-sidebar'), this);

    }

    initSettingsDialog() {
        this.settingsDialog = new SettingsDialog(this);
    }

    initAboutDialog() {
        this.aboutDialog = new AboutDialog(this);
    }

    initDefinitionsDialog() {
        this.definitionsDialog = new DefinitionsDialog(this);
        this.definitionsDialog.onClosed = ()=> this.recompute(true, true);

    }

    initSensitivityAnalysisDialog() {
        this.sensitivityAnalysisDialog = new SensitivityAnalysisDialog(this);

    }

    isSensitivityAnalysisAvailable() {
        return this.dataModel.getRoots().length===1 && this.computationsManager.isValid();
    }

    initToolbar() {
        this.toolbar = new Toolbar(this.container.select('#sd-toolbar'), this);

    }

    initPayoffNumberFormat() {

        this.payoffNumberFormat = new Intl.NumberFormat(this.config.format.locales, this.config.format.payoff);
    }

    initProbabilityNumberFormat() {
        this.probabilityNumberFormat = new Intl.NumberFormat(this.config.format.locales, this.config.format.probability);
    }

    initTreeDesigner() {
        var self = this;
        var config = this.getTreeDesignerInitialConfig();
        this.treeDesigner = new TreeDesigner(this.container.select('#tree-designer-container'), this.dataModel, config);
    }

    getTreeDesignerInitialConfig() {
        var self = this;
        return Utils.deepExtend({
            $readOnly: self.config.readOnly,
            onNodeSelected: function (node) {
                self.onObjectSelected(node);
            },
            onEdgeSelected: function (edge) {
                self.onObjectSelected(edge);
            },
            onTextSelected: function (text) {
                self.onObjectSelected(text);
            },
            onSelectionCleared: function () {
                self.onSelectionCleared();
            },
            payoffNumberFormatter: (v) => self.payoffNumberFormat.format(v),
            probabilityNumberFormatter: (v) => self.probabilityNumberFormat.format(v),
            operationsForObject: (o) => self.computationsManager.operationsForObject(o)
        }, self.config.treeDesigner);
    }

    onObjectSelected(object) {
        var self = this;
        if (this.selectedObject === object) {
            return;
        }
        this.selectedObject = object;
        setTimeout(function () {
            self.sidebar.updateObjectPropertiesView(self.selectedObject);
            self.updateVariableDefinitions();
            self.treeDesigner.updatePlottingRegionSize();
        }, 10)
    }

    onSelectionCleared() {
        var self = this;
        this.selectedObject = null;
        this.sidebar.hideObjectProperties();
        setTimeout(function () {
            self.updateVariableDefinitions();
            self.treeDesigner.updatePlottingRegionSize();
        }, 10);
        // console.log();
    }

    getCurrentVariableDefinitionsSourceObject() {
        if (this.selectedObject) {
            if (this.selectedObject instanceof model.domain.Node) {
                return this.selectedObject;
            }
            if (this.selectedObject instanceof model.domain.Edge) {
                return this.selectedObject.parentNode;
            }
        }
        return this.dataModel;
    }

    updateVariableDefinitions() {
        var self = this;
        var definitionsSourceObject = self.getCurrentVariableDefinitionsSourceObject();
        var readOnly = (this.selectedObject instanceof model.domain.Edge) || (this.selectedObject instanceof model.domain.TerminalNode);
        self.sidebar.updateDefinitions(definitionsSourceObject, readOnly, (code)=> {
            self.dataModel.saveState();
            definitionsSourceObject.code = code;
            self.recompute(true, true)
        });

    }

    openDefinitionsDialog() {
        var definitionsSourceObject = this.getCurrentVariableDefinitionsSourceObject();
        this.definitionsDialog.open(definitionsSourceObject, (code)=> {
            this.dataModel.saveState();
            definitionsSourceObject.code = code;
            this.recompute(true, true);
        });
    }

    updateView(withTransitions=true) {
        // console.log('_updateView');
        this.treeDesigner.redraw(withTransitions);
        this.sidebar.updateObjectPropertiesView(this.selectedObject);
        this.updateVariableDefinitions();
        this.toolbar.update();
        this.sidebar.updateLayoutOptions();
        this.sidebar.updateDiagramDetails();
    }

    undo() {
        var self = this;
        self.dataModel.undo();
        if (self.selectedObject) {
            self.selectedObject = self.dataModel.findById(self.selectedObject.$id);
        }
        return this.checkValidityAndRecomputeObjective(false, false, false).then(()=>{
            self.updateView();
        })

    }

    redo() {
        var self = this;
        self.dataModel.redo();
        if (self.selectedObject) {
            self.selectedObject = self.dataModel.findById(self.selectedObject.$id);
        }

        return this.checkValidityAndRecomputeObjective(false, false, false).then(()=>{
            self.updateView();
        })
    }

    onNodeAddedOrRemoved() {
        var self = this;
        return this.checkValidityAndRecomputeObjective().then(()=>{
            self.updateView();
        });

    }

    onTextAdded(text) {
        return this.onObjectSelected(text);
    }

    onTextRemoved(text) {
        this.updateView();
    }

    onObjectUpdated(object, fieldName) {
        var self = this;
        var p = Promise.resolve();
        if(!(object instanceof model.domain.Text) && fieldName!=='name'){
            p = p.then(()=>this.checkValidityAndRecomputeObjective());
        }
        // this.sidebar.updateObjectPropertiesView(this.selectedObject);
        return p.then(()=>{
            setTimeout(function () {
                self.treeDesigner.redraw(true);
            },1);
        });
    }

    setObjectiveRule(ruleName, evalCode=false, evalNumeric=false, updateView=true) {
        this.computationsManager.setCurrentRuleByName(ruleName);
        return this.checkValidityAndRecomputeObjective(false, evalCode, evalNumeric).then(()=>{
            if(updateView){
                this.updateView(true);
            }
        });

    }

    getCurrentObjectiveRule(){
        return this.computationsManager.getCurrentRule();
    }

    getObjectiveRules(){
        return this.computationsManager.getObjectiveRules();
    }


    openSensitivityAnalysis(){
        this.sensitivityAnalysisDialog.open();
    }

    showTreePreview(dataDTO, closeCallback, autoLayout=true){
        var self = this;
        this.originalDataModelSnapshot = this.dataModel.createStateSnapshot();
        this.dataModel.loadFromDTO(dataDTO,  this.computationsManager.expressionEngine.getJsonReviver());
        this.computationsManager.updateDisplayValues(this.dataModel);
        this.updateView(false);
        setTimeout(function(){
            self.updateView(false);
            setTimeout(function(){
                var svgString = Exporter.getSVGString(self.treeDesigner.svg.node());
                AppUtils.showFullScreenPopup('', svgString, ()=>{
                    if(closeCallback) {
                        self.dataModel._setNewState(self.originalDataModelSnapshot);
                        self.updateView(false);

                        closeCallback();
                        setTimeout(function(){
                            self.updateView(false);
                        }, 1)
                    }
                });
            }, 300);
        }, 1)

    }

    showPolicyPreview(title, policy, closeCallback){
        var self = this;
        this.originalDataModelSnapshot = this.dataModel.createStateSnapshot();
        this.computationsManager.displayPolicy(policy);
        this.updateView(false);
        AppUtils.showFullScreenPopup(title, '');
        LoadingIndicator.show();
        setTimeout(function(){
            self.updateView(false);
            setTimeout(function(){
                var svgString = Exporter.getSVGString(self.treeDesigner.svg.node(), true);
                LoadingIndicator.hide();
                AppUtils.showFullScreenPopup(title, svgString, ()=>{

                    self.dataModel._setNewState(self.originalDataModelSnapshot);

                    // self.computationsManager.updateDisplayValues(self.dataModel);
                    self.updateView(false);
                    if(closeCallback) {
                        closeCallback();
                    }
                    setTimeout(function(){
                        self.updateView(false);
                    }, 1)
                });
            }, 500);
        }, 1)
    }


    recompute(updateView = true, debounce = false) {
        if(debounce){
            if(!this.debouncedRecompute){
                this.debouncedRecompute = Utils.debounce((updateView)=>this.recompute(updateView, false), 200);
            }
            this.debouncedRecompute(updateView);
            return;
        }

        return this.checkValidityAndRecomputeObjective(false, true).then(()=>{
            if (updateView) {
                this.updateView();
            }
        });

    }

    checkValidityAndRecomputeObjective(allRules, evalCode=false, evalNumeric=true) {
        return this.computationsManager.checkValidityAndRecomputeObjective(allRules, evalCode, evalNumeric).then(()=>{
            this.updateValidationMessages();
            AppUtils.dispatchEvent('SilverDecisionsRecomputedEvent', this);
        }).catch(e=>{
            log.error(e);
        });

    }

    updateValidationMessages() {
        var self = this;
        setTimeout(function () {
            self.treeDesigner.updateValidationMessages();
        }, 1);
    }

    newDiagram() {
        this.clear();
        this.updateView();
    }

    clear() {
        this.dataModel.clear();
        this.setDiagramTitle('', true);
        this.setDiagramDescription('', true);
        this.treeDesigner.setConfig(Utils.deepExtend(this.getTreeDesignerInitialConfig()));
        this.onSelectionCleared();
        this.sensitivityAnalysisDialog.clear(true)
    }

    openDiagram(diagramData) {

        var self = this;
        var errors = [];

        if(Utils.isString(diagramData)){
            try{
                diagramData = JSON.parse(diagramData, self.computationsManager.expressionEngine.getJsonReviver());
            }catch (e){
                errors.push('error.jsonParse');
                alert(i18n.t('error.jsonParse'));
                log.error(e);
                return Promise.resolve(errors);
            }
        }

        var dataModelObject = diagramData.data;

        this.clear();
        if (!diagramData.SilverDecisions) {
            errors.push('error.notSilverDecisionsFile');
            alert(i18n.t('error.notSilverDecisionsFile'));
            return Promise.resolve(errors);
        }

        if(!Utils.isValidVersionString(diagramData.SilverDecisions)){
            errors.push('error.incorrectVersionFormat');
            alert(i18n.t('error.incorrectVersionFormat'));
        }else{
            //Check if version in file is newer than version of application
            if(Utils.compareVersionNumbers(diagramData.SilverDecisions, App.version)>0){
                errors.push('error.fileVersionNewerThanApplicationVersion');
                alert(i18n.t('error.fileVersionNewerThanApplicationVersion'));
            }

            if(Utils.compareVersionNumbers(diagramData.SilverDecisions, "0.7.0")<0){
                dataModelObject ={
                    code: diagramData.code,
                    expressionScope: diagramData.expressionScope,
                    trees: diagramData.trees,
                    texts: diagramData.texts
                }
            }
        }

        try {
            if (diagramData.lng) {
                this.config.lng = diagramData.lng;
            }
            if (diagramData.rule) {
                if (this.computationsManager.isRuleName(diagramData.rule)) {
                    this.config.rule = diagramData.rule;
                } else {
                    delete this.config.rule;
                }
            }
            if (diagramData.format) {
                this.config.format = diagramData.format;
            }

            this.setConfig(this.config);
            this.dataModel.load(dataModelObject);

            if (diagramData.treeDesigner) {
                this.treeDesigner.setConfig(Utils.deepExtend(self.getTreeDesignerInitialConfig(), diagramData.treeDesigner));
            }

            this.setDiagramTitle(diagramData.title || '', true);
            this.setDiagramDescription(diagramData.description || '', true);

            if(diagramData.sensitivityAnalysis){
                this.sensitivityAnalysisDialog.loadSavedParamValues(diagramData.sensitivityAnalysis) ;
            }

        } catch (e) {
            errors.push('error.malformedData');
            alert(i18n.t('error.malformedData'));
            this.clear();
            log.error('malformedData', e);
            return Promise.resolve(errors);

        }
        try {
            this.updateNumberFormats(false);
        } catch (e) {
            log.error('incorrectNumberFormatOptions', e);
            errors.push('error.incorrectNumberFormatOptions');
            alert(i18n.t('error.incorrectNumberFormatOptions'));
            delete this.config.format;
            this.setConfig(this.config);
            this.updateNumberFormats(false);
        }
        return this.setObjectiveRule(this.config.rule, false, true, false).catch(e=>{
            log.error('diagramDrawingFailure', e);
            errors.push('error.diagramDrawingFailure');
            alert(i18n.t('error.diagramDrawingFailure'));
            this.clear();
            return errors
        }).then(()=>{
            this.updateView(false);
            return errors;
        }).catch(e=>{
            log.error('diagramDrawingFailure', e);
            errors.push('error.diagramDrawingFailure');
            alert(i18n.t('error.diagramDrawingFailure'));
            this.clear();
            return errors
        });
    }

    serialize(filterLocation, filterComputed) {
        var self = this;
        return self.checkValidityAndRecomputeObjective(true, false, false).then(()=>{
            var obj = {
                SilverDecisions: App.version,
                buildTimestamp: App.buildTimestamp,
                savetime: d3.isoFormat(new Date()),
                lng: self.config.lng,
                rule: self.computationsManager.getCurrentRule().name,
                title: self.config.title,
                description: self.config.description,
                format: self.config.format,
                treeDesigner: self.treeDesigner.config,
                data: self.dataModel.serialize(false),
                sensitivityAnalysis: this.sensitivityAnalysisDialog.jobNameToParamValues
            };

            return Utils.stringify(obj, [self.dataModel.getJsonReplacer(filterLocation, filterComputed), self.computationsManager.expressionEngine.getJsonReplacer()]);
        });


    }

    updateNumberFormats(updateView=true) {
        this.initPayoffNumberFormat();
        this.initProbabilityNumberFormat();
        if(updateView){
            this.updateView();
        }
    }

    updatePayoffNumberFormat(updateView=true) {
        this.initPayoffNumberFormat();
        if(updateView){
            this.updateView();
        }

    }

    updateProbabilityNumberFormat(updateView=true) {
        this.initProbabilityNumberFormat();
        if(updateView){
            this.updateView();
        }
    }

    initOnBeforeUnload() {
        var self = this;
        window.addEventListener("beforeunload", function (e) {
            if (!(self.dataModel.isUndoAvailable() || self.dataModel.isRedoAvailable())) {
                return;
            }

            var dialogText = i18n.t('confirm.beforeunload');
            e.returnValue = dialogText;
            return dialogText;
        });
    }

    setConfigParam(path, value, withoutStateSaving, callback) {
        var self = this;
        var prevValue = Utils.get(this.config, path);

        if (prevValue == value) {
            return;
        }
        if (!withoutStateSaving) {
            this.dataModel.saveState({
                data: {
                    prevValue: prevValue
                },
                onUndo: (data)=> {
                    self.setConfigParam(path, data.prevValue, true, callback);
                },
                onRedo: (data)=> {
                    self.setConfigParam(path, value, true, callback);
                }
            });
        }
        Utils.set(this.config, path, value);
        if (callback) {
            callback(value);
        }
    }


    setDiagramTitle(title, withoutStateSaving) {
        this.setConfigParam('title', title, withoutStateSaving, (v) => this.treeDesigner.updateDiagramTitle(v));
    }

    setDiagramDescription(description, withoutStateSaving) {
        this.setConfigParam('description', description, withoutStateSaving, (v) => this.treeDesigner.updateDiagramDescription(v));
    }

    initKeyCodes() {

        this.container.on("keyup", (d)=> {
            if (d3.event.srcElement && ['INPUT', 'TEXTAREA'].indexOf(d3.event.srcElement.nodeName.toUpperCase()) > -1) { //ignore events from input and textarea elements
                return;
            }

            var key = d3.event.keyCode;
            if (key == 46) {//delete
                this.treeDesigner.removeSelectedNodes();
                this.treeDesigner.removeSelectedTexts();
                return;
            }
            if (!d3.event.ctrlKey) {
                return;
            }


            if (d3.event.altKey) {
                if (this.selectedObject instanceof model.domain.Node) {
                    let selectedNode = this.selectedObject;
                    if (selectedNode instanceof model.domain.TerminalNode) {
                        return;
                    }
                    if (key == 68) { // ctrl + alt + d
                        this.treeDesigner.addDecisionNode(selectedNode);
                    } else if (key == 67) { // ctrl + alt + c
                        this.treeDesigner.addChanceNode(selectedNode);
                    } else if (key == 84) { // ctrl + alt + t
                        this.treeDesigner.addTerminalNode(selectedNode);
                    }
                    return;
                } else if (this.selectedObject instanceof model.domain.Edge) {
                    if (key == 68) { // ctrl + alt + d
                        this.treeDesigner.injectDecisionNode(this.selectedObject);
                    } else if (key == 67) { // ctrl + alt + c
                        this.treeDesigner.injectChanceNode(this.selectedObject);
                    }
                }

            }


            if (key == 90) {//ctrl + z
                this.undo();
                return;
            }
            if (key == 89) {//ctrl + y
                this.redo();
                return;
            }

            /*if(key==65){//ctrl + a
             if(selectedNodes.length==1){
             this.treeDesigner.selectSubTree(selectedNodes[0])
             }else{
             this.treeDesigner.selectAllNodes();
             }
             // d3.event.preventDefault()
             return;
             }*/
            var selectedNodes = this.treeDesigner.getSelectedNodes();
            if (key == 86) {//ctrl + v
                if (selectedNodes.length == 1) {
                    let selectedNode = selectedNodes[0];
                    if (selectedNode instanceof model.domain.TerminalNode) {
                        return;
                    }
                    this.treeDesigner.pasteToNode(selectedNode)
                } else if (selectedNodes.length == 0) {

                }
                return;
            }

            if (!selectedNodes.length) {
                return;
            }

            if (key == 88) {//ctrl + x
                this.treeDesigner.cutSelectedNodes();

            } else if (key == 67) {//ctrl + c
                this.treeDesigner.copySelectedNodes();

            }

        });
    }
}
