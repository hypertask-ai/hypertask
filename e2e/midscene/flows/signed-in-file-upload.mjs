export default {
  id: 'signed-in-file-upload', area: 'files', title: 'Upload and reopen an attachment',
  description: 'Upload a small text file through the QA task\'s comment composer, reload it, then remove the file and task.',
  safe: true, signedIn: true,
  steps: [
    { action: 'createFixtureTask', arg: 'create a disposable QA task' },
    { action: 'goto', arg: '{{taskUrl}}' },
    { action: 'aiWaitFor', arg: 'the task detail and comment composer are visible' },
    { action: 'uploadFile', arg: 'input[type="file"][id*="comment"]' },
    { action: 'aiWaitFor', arg: 'the attachment "{{fileName}}" is visible in the comment composer' },
    { action: 'postAttachmentComment', arg: 'send the QA attachment comment and wait for persistence' },
    { action: 'goto', arg: '{{taskUrl}}' },
    { action: 'aiAssert', arg: 'a saved comment contains a file attachment badge, separate from the empty comment composer' },
    { action: 'verifyUpload', arg: 'uploaded file bytes can be downloaded' },
  ],
};
