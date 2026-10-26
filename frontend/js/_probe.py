powershell -Command $c = @'
print('hello world')
'@; $c | Out-File -Encoding UTF8 'C:/Users/LENOVO/Projects_github/carpooling/frontend/js/_probe.py'; Get-Content 'C:/Users/LENOVO/Projects_github/carpooling/frontend/js/_probe.py'
if(-not $?){exit 1}
