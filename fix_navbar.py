
path = 'c:/Users/LENOVO/Projects_github/carpooling/frontend/components/NavBar.tsx'
with open(path, 'r', encoding='utf-8') as f:
    content = f.read()

# Add ThemeToggle import
old_import = 'import { BrandMark } from @/components/BrandMark@'
new_import = '@old_import@
import { ThemeToggle } from @/components/ThemeToggle@'
content = content.replace(old_import, new_import)

with open(path, 'w', encoding='utf-8') as f:
    f.write(content)
print('NavBar.tsx import updated')
