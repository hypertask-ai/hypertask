// HighlightButton.tsx
import React from 'react';

interface HighlightButtonProps {
 color: string;
 isActive: boolean;
 onClick: () => void;
}

const HighlightButton: React.FC<HighlightButtonProps> = ({ color, isActive, onClick }) => (
 <button onClick={onClick} className={isActive ? 'is-active' : ''}>
    <p
      style={{background:color}} 
      className={`p-2 rounded-full`} />
 </button>
);

export default HighlightButton;