@echo off
if not exist "photos-optimized\keys" mkdir "photos-optimized\keys"
magick "photos\keys\setl.jpg"       -resize "1200x1200>" -quality 82 -strip "photos-optimized\keys\setl.jpg"
magick "photos\keys\den-donora.jpg" -resize "1200x1200>" -quality 82 -strip "photos-optimized\keys\den-donora.jpg"
magick "photos\keys\nyukomp.jpg"    -resize "1200x1200>" -quality 82 -strip "photos-optimized\keys\nyukomp.jpg"
echo Done!
pause
