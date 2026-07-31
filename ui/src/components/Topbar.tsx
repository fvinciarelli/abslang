import { useRef } from 'react';
import AppBar from '@mui/material/AppBar';
import Toolbar from '@mui/material/Toolbar';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import AddIcon from '@mui/icons-material/Add';
import UploadIcon from '@mui/icons-material/Upload';
import SaveIcon from '@mui/icons-material/Save';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import DarkModeIcon from '@mui/icons-material/DarkMode';

interface Props {
  onNew: () => void;
  onExport: () => void;
  onImport: (file: File) => void;
  isVSCode?: boolean;
}

export function Topbar({ onNew, onExport, onImport, isVSCode }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);

  const handleVSCodeSave = () => {
    window.dispatchEvent(new CustomEvent('abs-save', { detail: {} }));
  };

  const handleVSCodeRun = () => {
    window.dispatchEvent(new CustomEvent('abs-run'));
  };

  if (isVSCode) {
    return (
      <AppBar
        position="static"
        color="transparent"
        elevation={0}
        sx={{ borderBottom: '1px solid', borderColor: 'divider', bgcolor: 'white' }}
      >
        <Toolbar sx={{ minHeight: 52, px: 2.5, gap: 1, justifyContent: 'flex-end' }}>
          <Button
            size="small"
            variant="contained"
            color="success"
            startIcon={<PlayArrowIcon />}
            onClick={handleVSCodeRun}
          >
            Run
          </Button>
          <Button
            size="small"
            variant="contained"
            startIcon={<SaveIcon />}
            onClick={handleVSCodeSave}
          >
            Save
          </Button>
        </Toolbar>
      </AppBar>
    );
  }

  return (
    <AppBar
      position="static"
      color="transparent"
      elevation={0}
      sx={{ borderBottom: '1px solid', borderColor: 'divider', bgcolor: 'white' }}
    >
      <input
        ref={fileRef}
        type="file"
        accept=".yaml,.yml,.abs.yaml"
        style={{ display: 'none' }}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onImport(file);
          e.target.value = '';
        }}
      />
      <Toolbar sx={{ minHeight: 52, px: 2.5, gap: 1, justifyContent: 'flex-end' }}>
        <IconButton size="small">
          <DarkModeIcon fontSize="small" />
        </IconButton>
        <Button size="small" variant="outlined" startIcon={<AddIcon />} onClick={onNew}>
          New
        </Button>
        <Button
          size="small"
          variant="outlined"
          startIcon={<UploadIcon />}
          onClick={() => fileRef.current?.click()}
        >
          Import
        </Button>
        <Button size="small" variant="contained" startIcon={<SaveIcon />} onClick={onExport}>
          Export YAML
        </Button>
      </Toolbar>
    </AppBar>
  );
}
