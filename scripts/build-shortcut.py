# Builds the iPhone "Send to JED CRM" shortcut (Settings -> iPhone shortcut).
# Run on a Mac, then sign it so iPhones can install it:
#   python3 scripts/build-shortcut.py /tmp/unsigned.shortcut
#   shortcuts sign --mode anyone --input /tmp/unsigned.shortcut --output public/shortcut/Send-to-JED-CRM.shortcut
# The personal key is asked for when someone adds the shortcut; none is stored here.
import plistlib, uuid, sys

BASE = 'https://dealflow-crm-gamma.vercel.app'
OBJ = '￼'

def uid(): return str(uuid.uuid4()).upper()
def out(u, name): return {'OutputUUID': u, 'Type': 'ActionOutput', 'OutputName': name}
def attach(v): return {'Value': v, 'WFSerializationType': 'WFTextTokenAttachment'}
def tokens(parts):
    """parts: list of str or attachment-dicts -> WFTextTokenString"""
    s, att = '', {}
    for p in parts:
        if isinstance(p, str): s += p
        else:
            att['{%d, 1}' % len(s)] = p
            s += OBJ
    return {'Value': {'string': s, 'attachmentsByRange': att}, 'WFSerializationType': 'WFTextTokenString'}
def dict_field(items):
    return {'Value': {'WFDictionaryFieldValueItems': [
        {'WFItemType': 0, 'WFKey': tokens([k]), 'WFValue': tokens(v if isinstance(v, list) else [v])} for k, v in items
    ]}, 'WFSerializationType': 'WFDictionaryFieldValue'}

KEY = {'Type': 'Variable', 'VariableName': 'JED key'}
auth = ('Authorization', ['Bearer ', KEY])
INPUT = {'Type': 'ExtensionInput'}
INPUT_EXT = {'Type': 'ExtensionInput', 'Aggrandizements': [{'Type': 'WFPropertyVariableAggrandizement', 'PropertyName': 'File Extension'}]}

t, d, sp, ch, st, up, put, fin, done = (uid() for _ in range(9))
actions = [
    {'WFWorkflowActionIdentifier': 'is.workflow.actions.gettext',
     'WFWorkflowActionParameters': {'UUID': t, 'WFTextActionText': ''}},
    {'WFWorkflowActionIdentifier': 'is.workflow.actions.setvariable',
     'WFWorkflowActionParameters': {'WFVariableName': 'JED key', 'WFInput': attach(out(t, 'Text'))}},
    # 1. The deals to pick from.
    {'WFWorkflowActionIdentifier': 'is.workflow.actions.downloadurl',
     'WFWorkflowActionParameters': {'UUID': d, 'WFURL': f'{BASE}/api/shortcut/deals', 'WFHTTPMethod': 'GET',
                                    'ShowHeaders': True, 'WFHTTPHeaders': dict_field([auth])}},
    {'WFWorkflowActionIdentifier': 'is.workflow.actions.text.split',
     'WFWorkflowActionParameters': {'UUID': sp, 'text': attach(out(d, 'Contents of URL')), 'WFTextSeparator': 'New Lines'}},
    {'WFWorkflowActionIdentifier': 'is.workflow.actions.choosefromlist',
     'WFWorkflowActionParameters': {'UUID': ch, 'WFInput': attach(out(sp, 'Split Text')),
                                    'WFChooseFromListActionPrompt': 'Which deal is this call for?'}},
    # 2. Where to upload it.
    {'WFWorkflowActionIdentifier': 'is.workflow.actions.downloadurl',
     'WFWorkflowActionParameters': {'UUID': st, 'WFURL': f'{BASE}/api/shortcut/start', 'WFHTTPMethod': 'POST',
                                    'ShowHeaders': True, 'WFHTTPHeaders': dict_field([auth]),
                                    'WFHTTPBodyType': 'JSON',
                                    'WFJSONValues': dict_field([('deal', [out(ch, 'Chosen Item')]), ('ext', [INPUT_EXT])])}},
    {'WFWorkflowActionIdentifier': 'is.workflow.actions.getvalueforkey',
     'WFWorkflowActionParameters': {'UUID': up, 'WFInput': attach(out(st, 'Contents of URL')),
                                    'WFGetDictionaryValueType': 'Value', 'WFDictionaryKey': 'upload_url'}},
    # 3. Upload the recording straight to storage.
    {'WFWorkflowActionIdentifier': 'is.workflow.actions.downloadurl',
     'WFWorkflowActionParameters': {'UUID': put, 'WFURL': tokens([out(up, 'Dictionary Value')]), 'WFHTTPMethod': 'PUT',
                                    'ShowHeaders': True, 'WFHTTPHeaders': dict_field([('Content-Type', 'audio/mp4')]),
                                    'WFHTTPBodyType': 'File', 'WFRequestVariable': attach(INPUT)}},
    {'WFWorkflowActionIdentifier': 'is.workflow.actions.getvalueforkey',
     'WFWorkflowActionParameters': {'UUID': fin, 'WFInput': attach(out(st, 'Contents of URL')),
                                    'WFGetDictionaryValueType': 'Value', 'WFDictionaryKey': 'finish_url'}},
    # 4. File it on the deal and start the notes.
    {'WFWorkflowActionIdentifier': 'is.workflow.actions.downloadurl',
     'WFWorkflowActionParameters': {'UUID': done, 'WFURL': tokens([out(fin, 'Dictionary Value')]), 'WFHTTPMethod': 'POST',
                                    'ShowHeaders': True, 'WFHTTPHeaders': dict_field([auth])}},
    {'WFWorkflowActionIdentifier': 'is.workflow.actions.notification',
     'WFWorkflowActionParameters': {'WFNotificationActionTitle': 'JED CRM',
                                    'WFNotificationActionBody': tokens([out(done, 'Contents of URL')]),
                                    'WFNotificationActionSound': False}},
]

wf = {
    'WFWorkflowClientVersion': '2607.0.6',
    'WFWorkflowMinimumClientVersion': 900,
    'WFWorkflowMinimumClientVersionString': '900',
    'WFWorkflowIcon': {'WFWorkflowIconStartColor': 4282601983, 'WFWorkflowIconGlyphNumber': 61440},
    'WFWorkflowTypes': ['ActionExtension'],
    'WFWorkflowInputContentItemClasses': ['WFAVAssetContentItem', 'WFGenericFileContentItem'],
    'WFWorkflowHasShortcutInputVariables': True,
    'WFWorkflowNoInputBehavior': {'Name': 'WFWorkflowNoInputBehaviorAskForInput', 'Parameters': {'ItemClass': 'WFGenericFileContentItem'}},
    'WFWorkflowImportQuestions': [{
        'ActionIndex': 0, 'Category': 'Parameter', 'DefaultValue': '', 'ParameterKey': 'WFTextActionText',
        'Text': 'Paste your personal key from JED CRM → Settings → iPhone shortcut',
    }],
    'WFWorkflowActions': actions,
    'WFQuickActionSurfaces': [],
    'WFWorkflowHasOutputFallback': False,
    'WFWorkflowOutputContentItemClasses': [],
}
with open(sys.argv[1], 'wb') as f:
    plistlib.dump(wf, f, fmt=plistlib.FMT_BINARY)
print('written')
