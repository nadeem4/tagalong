/**
 * Settings' "Files Scout may use" section: the folders the person named, each removable, and
 * an Add folder button. Pure markup; the page does the saving, and the file tools read the
 * result live, so Remove takes effect at once.
 */
import { Button } from '@tagalong/ui';
import { Section } from './section';

interface FilesSectionProps {
  folders: readonly string[];
  onAdd: () => void;
  onRemove: (folder: string) => void;
}

export function FilesSection({ folders, onAdd, onRemove }: FilesSectionProps) {
  return (
    <Section id="files">
      <p className="tg-help">
        Scout can list, read, move, rename and overwrite files, and send them to the Recycle Bin,
        only inside the folders you add here. None by default. It asks before it changes anything,
        and Remove takes a folder away at once.
      </p>
      {folders.length === 0 ? (
        <p className="tg-help">No folders yet.</p>
      ) : (
        <ul className="tg-folders">
          {folders.map((folder) => (
            <li key={folder} className="tg-folder">
              <code className="tg-folder__path">{folder}</code>
              <Button
                variant="quiet"
                aria-label={`Remove ${folder}`}
                onClick={() => {
                  onRemove(folder);
                  // The Remove button is gone next: keep the keyboard on this section.
                  document.getElementById('files-add')?.focus();
                }}
              >
                Remove
              </Button>
            </li>
          ))}
        </ul>
      )}
      <div className="tg-inline">
        <Button id="files-add" variant="secondary" onClick={onAdd}>
          Add folder
        </Button>
      </div>
    </Section>
  );
}
