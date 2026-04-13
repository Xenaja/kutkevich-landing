@echo off

if not exist "photos-optimized\hero" mkdir "photos-optimized\hero"
if not exist "photos-optimized\gallery" mkdir "photos-optimized\gallery"
if not exist "photos-optimized\assortment" mkdir "photos-optimized\assortment"

echo [1/3] Hero...
magick mogrify -path "photos-optimized\hero" -resize "1920x1920>" -quality 82 -strip "photos\hero\*.jpg"
magick mogrify -path "photos-optimized\hero" -resize "1920x1920>" -quality 82 -strip -format jpg "photos\hero\*.png"

echo [2/3] Gallery...
magick mogrify -path "photos-optimized\gallery" -resize "1920x1920>" -quality 82 -strip "photos\gallery\*.jpg"
magick mogrify -path "photos-optimized\gallery" -resize "1920x1920>" -quality 82 -strip "photos\gallery\*.JPG"

echo [3/3] Assortment...
magick mogrify -path "photos-optimized\assortment" -resize "1920x1920>" -quality 82 -strip "photos\assortment\*.jpg"
magick mogrify -path "photos-optimized\assortment" -resize "1920x1920>" -quality 82 -strip -format jpg "photos\assortment\*.png"

echo Done!
pause
