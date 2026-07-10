# Inicia o servidor Huawai automaticamente somente se houver internet
if [ -x "$HOME/huawai/iniciar-servidor.sh" ]; then
    if ping -c 1 -W 2 1.1.1.1 >/dev/null 2>&1; then
        if "$HOME/huawai/iniciar-servidor.sh" >/dev/null 2>&1; then
            clear
            echo "."
            echo ".."
            echo "..."
            echo "....."
            echo "......."
            echo "........."
            echo "..........."
            echo "............."
            echo "Servidor iniciado!"
            echo "JÁ PODE VOLTAR AO APLICATIVO DE PRESET"

            sleep 2
            exit
        else
            clear
            echo "Falha ao iniciar o servidor."
        fi
    else
        clear
        echo "Sem conexão com a internet."
    fi
fi

export PATH=$HOME/.npm-global/bin:$PATH
